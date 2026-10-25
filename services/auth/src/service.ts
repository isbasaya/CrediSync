import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { withSystem, withUser, writeAudit } from '@credisync/db';
import { encryptToBytes, hmacLookup, randomToken, sha256Hex } from '@credisync/crypto';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS, type Role } from '@credisync/middleware';
import { normaliseSaIdNumber, validateSaIdNumber } from '@credisync/types';
import { sendEmail } from '@credisync/notifications';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const REFRESH_TOKEN_TTL_DAYS = 30;
const VERIFICATION_TTL_HOURS = 24;
const DELETION_GRACE_DAYS = 7;

/** Current privacy notice version; bump when the notice text changes so users re-consent. */
export const CURRENT_POPIA_POLICY_VERSION = process.env.POPIA_POLICY_VERSION ?? '2026-10-01';

export interface PublicUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  is_verified: boolean;
  is_active: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// A real bcrypt hash of a random string: comparing against it when the email
// is unknown keeps response timing the same as for a real account.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), BCRYPT_ROUNDS);

const USER_COLUMNS = 'id, email, first_name, last_name, role, is_verified, is_active';

function toPublicUser(row: Record<string, unknown>): PublicUser {
  return {
    id: row.id as string,
    email: row.email as string,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    role: row.role as Role,
    is_verified: row.is_verified as boolean,
    is_active: row.is_active as boolean,
  };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** bcrypt silently ignores bytes past 72, so longer passwords would be truncated. */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 10)
    throw new AuthError('weak_password', 'Password must be at least 10 characters', 400);
  if (Buffer.byteLength(password, 'utf-8') > 72) {
    throw new AuthError('password_too_long', 'Password must be at most 72 bytes', 400);
  }
}

export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  mobileNumber: string;
  saIdNumber: string;
  popiaConsent: true;
  popiaPolicyVersion: string;
  creditCheckConsent: boolean;
  marketingConsent?: boolean;
}

export async function signup(
  pool: Pool,
  input: SignupInput,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  assertPasswordPolicy(input.password);
  if (input.popiaPolicyVersion !== CURRENT_POPIA_POLICY_VERSION) {
    throw new AuthError(
      'stale_policy_version',
      'Please review the current privacy notice and accept it again',
      409,
    );
  }

  const saId = normaliseSaIdNumber(input.saIdNumber);
  const validation = validateSaIdNumber(saId);
  if (!validation.valid) {
    throw new AuthError('invalid_sa_id', 'That South African ID number is not valid', 400);
  }

  const email = normaliseEmail(input.email);
  const saIdHash = hmacLookup(saId);
  const [passwordHash, saIdEncrypted] = await Promise.all([
    bcrypt.hash(input.password, BCRYPT_ROUNDS),
    encryptToBytes(saId),
  ]);
  const id = randomUUID();

  const verificationToken = randomToken();

  const user = await withSystem(pool, async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM credisync.users WHERE email = $1 OR sa_id_hash = $2 LIMIT 1',
      [email, saIdHash],
    );
    if (existing.rowCount) {
      // One generic message for email or ID collisions.
      throw new AuthError(
        'account_exists',
        'An account already exists for these details. Try signing in.',
        409,
      );
    }

    try {
      await client.query(
        `INSERT INTO credisync.users (
           id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
           popia_consent_granted, popia_consent_date, popia_policy_version,
           credit_check_consent, marketing_consent, auth_provider, is_verified
         ) VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE, NOW(), $8, $9, $10, 'email', FALSE)`,
        [
          id,
          email,
          input.mobileNumber,
          input.firstName.trim(),
          input.lastName.trim(),
          saIdEncrypted,
          saIdHash,
          input.popiaPolicyVersion,
          input.creditCheckConsent,
          input.marketingConsent ?? false,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AuthError(
          'account_exists',
          'An account already exists for these details. Try signing in.',
          409,
        );
      }
      throw err;
    }

    await client.query(
      'INSERT INTO credisync.user_passwords (user_id, password_hash) VALUES ($1, $2)',
      [id, passwordHash],
    );

    const consents: Array<[string, boolean]> = [
      ['popia', true],
      ['credit_check', input.creditCheckConsent],
      ['marketing', input.marketingConsent ?? false],
    ];
    for (const [type, value] of consents) {
      await client.query(
        `INSERT INTO credisync.popia_consent_audit (user_id, consent_type, previous_value, new_value, policy_version, ip_address, user_agent)
         VALUES ($1, $2, NULL, $3, $4, $5::inet, $6)`,
        [id, type, value, input.popiaPolicyVersion, meta.ip ?? null, meta.userAgent ?? null],
      );
    }

    await client.query(
      `INSERT INTO credisync.email_verification_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + make_interval(hours => $3))`,
      [sha256Hex(verificationToken), id, VERIFICATION_TTL_HOURS],
    );

    await writeAudit(client, {
      userId: id,
      eventType: 'user_registered',
      resourceType: 'user',
      resourceId: id,
      payload: {
        policy_version: input.popiaPolicyVersion,
        credit_check_consent: input.creditCheckConsent,
      },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const row = await client.query(`SELECT ${USER_COLUMNS} FROM credisync.users WHERE id = $1`, [
      id,
    ]);
    return toPublicUser(row.rows[0]!);
  });

  await sendVerificationEmail(user.email, verificationToken);
  const tokens = await issueSession(pool, user, meta);
  return { user, ...tokens };
}

async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const base = process.env.WEB_APP_URL ?? 'http://localhost:3000';
  await sendEmail({
    to: email,
    subject: 'Confirm your CrediSync email address',
    body: `Confirm your email address to finish setting up CrediSync: ${base}/verify-email?token=${encodeURIComponent(token)}\n\nThis link expires in ${VERIFICATION_TTL_HOURS} hours.`,
  });
}

const GENERIC_LOGIN_FAILURE = new AuthError(
  'invalid_credentials',
  'Invalid email or password, or the account is temporarily locked',
  401,
);

export async function login(
  pool: Pool,
  emailInput: string,
  password: string,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const email = normaliseEmail(emailInput);

  const outcome = await withSystem(pool, async (client) => {
    const result = await client.query(
      `SELECT u.${USER_COLUMNS.split(', ').join(', u.')}, u.locked_until, p.password_hash
       FROM credisync.users u
       LEFT JOIN credisync.user_passwords p ON p.user_id = u.id
       WHERE u.email = $1`,
      [email],
    );
    const row = result.rows[0];

    // Always run bcrypt so unknown emails take the same time as known ones.
    const hash = (row?.password_hash as string | undefined) ?? DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hash);

    if (!row) return { ok: false as const };

    const locked = row.locked_until && new Date(row.locked_until).getTime() > Date.now();
    if (locked || !row.is_active || !row.password_hash || !passwordOk) {
      if (!locked && row.is_active) {
        const updated = await client.query<{
          failed_login_attempts: number;
          locked_until: Date | null;
        }>(
          `UPDATE credisync.users
             SET failed_login_attempts = failed_login_attempts + 1,
                 locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                                     THEN NOW() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1
           RETURNING failed_login_attempts, locked_until`,
          [row.id, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES],
        );
        if (updated.rows[0]?.locked_until) {
          await writeAudit(client, {
            userId: row.id,
            eventType: 'account_locked',
            resourceType: 'user',
            resourceId: row.id,
            ipAddress: meta.ip,
          });
        }
      }
      await writeAudit(client, {
        userId: row.id,
        eventType: 'user_login_failed',
        resourceType: 'user',
        resourceId: row.id,
        success: false,
        payload: { reason: locked ? 'locked' : !row.is_active ? 'inactive' : 'bad_password' },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: false as const };
    }

    await client.query(
      'UPDATE credisync.users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [row.id],
    );
    await writeAudit(client, {
      userId: row.id,
      eventType: 'user_login',
      resourceType: 'user',
      resourceId: row.id,
      payload: { method: 'email' },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: true as const, user: toPublicUser(row) };
  });

  if (!outcome.ok) throw GENERIC_LOGIN_FAILURE;
  const tokens = await issueSession(pool, outcome.user, meta);
  return { user: outcome.user, ...tokens };
}

function accessTokenFor(user: PublicUser): string {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    verified: user.is_verified,
  });
}

async function insertSession(
  client: PoolClient,
  userId: string,
  familyId: string,
  meta: RequestMeta,
): Promise<string> {
  const refreshToken = randomToken(48);
  await client.query(
    `INSERT INTO credisync.user_sessions (user_id, family_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5::inet, NOW() + make_interval(days => $6))`,
    [
      userId,
      familyId,
      sha256Hex(refreshToken),
      meta.userAgent ?? null,
      meta.ip ?? null,
      REFRESH_TOKEN_TTL_DAYS,
    ],
  );
  return refreshToken;
}

async function issueSession(pool: Pool, user: PublicUser, meta: RequestMeta): Promise<AuthTokens> {
  const refreshToken = await withSystem(pool, (client) =>
    insertSession(client, user.id, randomUUID(), meta),
  );
  return { accessToken: accessTokenFor(user), refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token means it was
 * stolen or replayed, so the whole session family is revoked.
 */
export async function refresh(
  pool: Pool,
  refreshToken: string,
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const result = await withSystem(pool, async (client) => {
    const found = await client.query(
      `SELECT s.id AS session_id, s.family_id, s.user_id, s.expires_at, s.rotated_at, s.revoked_at,
              u.${USER_COLUMNS.split(', ').join(', u.')}
       FROM credisync.user_sessions s JOIN credisync.users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1
       FOR UPDATE OF s`,
      [sha256Hex(refreshToken)],
    );
    const s = found.rows[0];
    if (!s) return null;

    if (s.rotated_at || s.revoked_at) {
      await client.query(
        'UPDATE credisync.user_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL',
        [s.family_id],
      );
      return null;
    }
    if (new Date(s.expires_at).getTime() <= Date.now() || !s.is_active) return null;

    await client.query('UPDATE credisync.user_sessions SET rotated_at = NOW() WHERE id = $1', [
      s.session_id,
    ]);
    const next = await insertSession(client, s.user_id, s.family_id, meta);
    return { user: toPublicUser({ ...s, id: s.user_id }), refreshToken: next };
  });

  if (!result)
    throw new AuthError('invalid_refresh_token', 'Session expired. Please sign in again.', 401);
  return {
    user: result.user,
    accessToken: accessTokenFor(result.user),
    refreshToken: result.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function logout(
  pool: Pool,
  refreshToken: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withSystem(pool, async (client) => {
    const found = await client.query<{ family_id: string; user_id: string }>(
      'SELECT family_id, user_id FROM credisync.user_sessions WHERE refresh_token_hash = $1',
      [sha256Hex(refreshToken)],
    );
    const s = found.rows[0];
    if (!s) return;
    await client.query(
      'UPDATE credisync.user_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL',
      [s.family_id],
    );
    await writeAudit(client, {
      userId: s.user_id,
      eventType: 'user_logout',
      resourceType: 'user',
      resourceId: s.user_id,
      ipAddress: meta.ip,
    });
  });
}

export async function verifyEmail(pool: Pool, token: string): Promise<AuthResult | null> {
  const user = await withSystem(pool, async (client) => {
    const found = await client.query<{ user_id: string }>(
      `UPDATE credisync.email_verification_tokens SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [sha256Hex(token)],
    );
    const userId = found.rows[0]?.user_id;
    if (!userId) return null;
    const updated = await client.query(
      `UPDATE credisync.users SET is_verified = TRUE, email_verified_at = NOW() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [userId],
    );
    await writeAudit(client, {
      userId,
      eventType: 'email_verified',
      resourceType: 'user',
      resourceId: userId,
    });
    return toPublicUser(updated.rows[0]!);
  });
  if (!user) return null;
  const tokens = await issueSession(pool, user, {});
  return { user, ...tokens };
}

export interface ProfileView extends PublicUser {
  mobile_number: string;
  consents: {
    popia: boolean;
    popiaPolicyVersion: string | null;
    creditCheck: boolean;
    openBanking: boolean;
    marketing: boolean;
    thirdPartySharing: boolean;
  };
  currentPolicyVersion: string;
  deletionScheduledFor: string | null;
}

export async function getProfile(pool: Pool, userId: string): Promise<ProfileView | null> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      `SELECT ${USER_COLUMNS}, mobile_number, popia_consent_granted, popia_policy_version, credit_check_consent,
              open_banking_consent, marketing_consent, third_party_sharing,
              (SELECT scheduled_for FROM credisync.data_deletion_requests d
                WHERE d.user_id = users.id AND d.completed_at IS NULL AND d.cancelled_at IS NULL
                ORDER BY requested_at DESC LIMIT 1) AS deletion_scheduled_for
       FROM credisync.users WHERE id = $1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      ...toPublicUser(row),
      mobile_number: row.mobile_number,
      consents: {
        popia: row.popia_consent_granted,
        popiaPolicyVersion: row.popia_policy_version,
        creditCheck: row.credit_check_consent,
        openBanking: row.open_banking_consent,
        marketing: row.marketing_consent,
        thirdPartySharing: row.third_party_sharing,
      },
      currentPolicyVersion: CURRENT_POPIA_POLICY_VERSION,
      deletionScheduledFor: row.deletion_scheduled_for
        ? new Date(row.deletion_scheduled_for).toISOString()
        : null,
    };
  });
}

const CONSENT_COLUMNS = {
  creditCheck: { column: 'credit_check_consent', type: 'credit_check' },
  openBanking: { column: 'open_banking_consent', type: 'open_banking' },
  marketing: { column: 'marketing_consent', type: 'marketing' },
  thirdPartySharing: { column: 'third_party_sharing', type: 'third_party' },
} as const;

export type ConsentKey = keyof typeof CONSENT_COLUMNS;

export async function updateConsents(
  pool: Pool,
  userId: string,
  changes: Partial<Record<ConsentKey, boolean>>,
  meta: RequestMeta = {},
): Promise<void> {
  await withUser(pool, userId, async (client) => {
    const current = await client.query(
      'SELECT credit_check_consent, open_banking_consent, marketing_consent, third_party_sharing FROM credisync.users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const row = current.rows[0];
    if (!row) throw new AuthError('not_found', 'User not found', 404);

    for (const [key, value] of Object.entries(changes) as Array<
      [ConsentKey, boolean | undefined]
    >) {
      if (value === undefined) continue;
      const { column, type } = CONSENT_COLUMNS[key];
      const previous = row[column] as boolean;
      if (previous === value) continue;

      // Column names come from the fixed CONSENT_COLUMNS map, never from input.
      await client.query(`UPDATE credisync.users SET ${column} = $2 WHERE id = $1`, [
        userId,
        value,
      ]);
      await client.query(
        `INSERT INTO credisync.popia_consent_audit (user_id, consent_type, previous_value, new_value, policy_version, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
        [
          userId,
          type,
          previous,
          value,
          CURRENT_POPIA_POLICY_VERSION,
          meta.ip ?? null,
          meta.userAgent ?? null,
        ],
      );
      if (key === 'openBanking' && !value) {
        // Revoking open-banking consent also destroys stored provider tokens.
        await client.query(
          'UPDATE credisync.open_banking_links SET token_encrypted = NULL, revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
          [userId],
        );
      }
      await writeAudit(client, {
        userId,
        eventType: value ? 'consent_granted' : 'consent_revoked',
        resourceType: 'consent',
        payload: { consent_type: type, policy_version: CURRENT_POPIA_POLICY_VERSION },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  });
}

/** POPIA s24: schedule erasure after a short grace period, and revoke all sessions now. */
export async function requestDeletion(
  pool: Pool,
  userId: string,
  meta: RequestMeta = {},
): Promise<{ scheduledFor: string }> {
  const scheduledFor = await withUser(pool, userId, async (client) => {
    const existing = await client.query<{ scheduled_for: Date }>(
      `SELECT scheduled_for FROM credisync.data_deletion_requests
       WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL`,
      [userId],
    );
    if (existing.rows[0]) return existing.rows[0].scheduled_for;

    const inserted = await client.query<{ scheduled_for: Date }>(
      `INSERT INTO credisync.data_deletion_requests (user_id, scheduled_for)
       VALUES ($1, NOW() + make_interval(days => $2)) RETURNING scheduled_for`,
      [userId, DELETION_GRACE_DAYS],
    );
    await writeAudit(client, {
      userId,
      eventType: 'data_deletion_request',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return inserted.rows[0]!.scheduled_for;
  });
  return { scheduledFor: new Date(scheduledFor).toISOString() };
}

export async function cancelDeletion(pool: Pool, userId: string): Promise<void> {
  await withUser(pool, userId, (client) =>
    client.query(
      `UPDATE credisync.data_deletion_requests SET cancelled_at = NOW()
       WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL`,
      [userId],
    ),
  );
}

/** POPIA s23: everything we hold about the data subject, in machine-readable form. */
export async function exportPersonalData(
  pool: Pool,
  userId: string,
  meta: RequestMeta = {},
): Promise<Record<string, unknown>> {
  return withUser(pool, userId, async (client) => {
    const q = async (sql: string) => (await client.query(sql, [userId])).rows;
    const [user, profiles, accounts, snapshots, disputes, consents, links] = await Promise.all([
      q(`SELECT id, email, mobile_number, first_name, last_name, popia_consent_granted, popia_consent_date,
                popia_policy_version, credit_check_consent, marketing_consent, third_party_sharing,
                open_banking_consent, created_at, last_login_at FROM credisync.users WHERE id = $1`),
      q('SELECT * FROM credisync.credit_profiles WHERE user_id = $1 ORDER BY created_at DESC'),
      q('SELECT * FROM credisync.bureau_accounts WHERE user_id = $1 ORDER BY created_at DESC'),
      q(
        'SELECT * FROM credisync.financial_health_snapshots WHERE user_id = $1 ORDER BY period_end DESC',
      ),
      q('SELECT * FROM credisync.disputes WHERE user_id = $1 ORDER BY created_at DESC'),
      q(
        'SELECT consent_type, previous_value, new_value, policy_version, created_at FROM credisync.popia_consent_audit WHERE user_id = $1 ORDER BY created_at',
      ),
      q(
        'SELECT id, source, created_at, revoked_at FROM credisync.open_banking_links WHERE user_id = $1',
      ),
    ]);
    await writeAudit(client, {
      userId,
      eventType: 'data_export',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: meta.ip,
    });
    return {
      exportedAt: new Date().toISOString(),
      note: 'Your SA ID number is stored encrypted and is not included in exports. Contact support to confirm it.',
      user: user[0] ?? null,
      creditProfiles: profiles,
      bureauAccounts: accounts,
      financialHealthSnapshots: snapshots,
      disputes,
      consentHistory: consents,
      openBankingLinks: links,
    };
  });
}
