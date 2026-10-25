import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { pool } from './db';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '24h';
const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_verified: boolean;
  is_active: boolean;
}

export interface AuthResult {
  user: User;
  accessToken: string;
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function signup(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  mobileNumber: string;
  saIdHash: string;
  popiaConsent: boolean;
}): Promise<AuthResult> {
  const existing = await pool.query('SELECT id FROM credisync.users WHERE email = $1', [
    input.email,
  ]);
  if (existing.rows.length > 0) {
    throw new AuthError('email_taken', 'An account with this email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const id = randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_hash, popia_consent_granted, popia_consent_date, auth_provider, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'email', TRUE)`,
      [
        id,
        input.email,
        input.mobileNumber,
        input.firstName,
        input.lastName,
        input.saIdHash,
        input.popiaConsent,
        input.popiaConsent ? new Date() : null,
      ]
    );
    await client.query(
      `INSERT INTO credisync.user_passwords (user_id, password_hash) VALUES ($1, $2)`,
      [id, passwordHash]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(
    `SELECT id, email, first_name, last_name, is_verified, is_active FROM credisync.users WHERE id = $1`,
    [id]
  );

  const row = result.rows[0]!;
  const user: User = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    is_verified: row.is_verified,
    is_active: row.is_active,
  };

  await pool.query(
    `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, success, payload)
     VALUES ($1, 'user_registered', 'user', TRUE, $2::jsonb)`,
    [id, JSON.stringify({ email: input.email })]
  );

  const accessToken = signToken(user);
  return { user, accessToken };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const result = await pool.query(
    `SELECT id, email, first_name, last_name, is_verified, is_active, failed_login_attempts, locked_until
     FROM credisync.users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw new AuthError('invalid_credentials', 'Invalid email or password', 401);
  }

  const row = result.rows[0]!;

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new AuthError('account_locked', 'Account is temporarily locked due to too many failed attempts', 423);
  }

  if (!row.is_active) {
    throw new AuthError('account_inactive', 'This account has been deactivated', 403);
  }

  const passwordResult = await pool.query(
    `SELECT password_hash FROM credisync.user_passwords WHERE user_id = $1`,
    [row.id]
  );

  if (passwordResult.rows.length === 0) {
    throw new AuthError('invalid_credentials', 'Invalid email or password', 401);
  }

  const passwordHash = passwordResult.rows[0]!.password_hash as string;
  const valid = await bcrypt.compare(password, passwordHash);

  if (!valid) {
    const attempts = (row.failed_login_attempts as number) + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;

    await pool.query(
      `UPDATE credisync.users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
      [attempts, lockedUntil, row.id]
    );

    throw new AuthError('invalid_credentials', 'Invalid email or password', 401);
  }

  await pool.query(
    `UPDATE credisync.users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
    [row.id]
  );

  const user: User = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    is_verified: row.is_verified,
    is_active: row.is_active,
  };

  await pool.query(
    `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, success, payload)
     VALUES ($1, 'user_login', 'user', TRUE, $2::jsonb)`,
    [row.id, JSON.stringify({ method: 'email' })]
  );

  const accessToken = signToken(user);
  return { user, accessToken };
}

export function signToken(user: User): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): { sub: string; email: string; name: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    return { sub: decoded.sub as string, email: decoded.email, name: decoded.name };
  } catch {
    throw new AuthError('invalid_token', 'Invalid or expired token', 401);
  }
}
