import { createHash, randomBytes } from 'crypto';
import { isLocalEnv, requireSecret } from '@credisync/config';

/**
 * Stitch "user token" flow (OAuth 2.0 authorization code + PKCE S256), per
 * https://docs.stitch.money/authentication/user-tokens:
 *
 *   1. Redirect the consumer to /connect/authorize with client_id, scope,
 *      response_type=code, redirect_uri (whitelisted with Stitch), nonce,
 *      state (CSRF, validated on return) and code_challenge.
 *   2. Exchange the returned code at /connect/token with the code_verifier
 *      and client_secret. Codes are single-use.
 *   3. Refresh with grant_type=refresh_token when the access token expires;
 *      Stitch returns a NEW refresh token each time (store it).
 *
 * Scopes: openid (required), offline_access (refresh tokens), accounts,
 * transactions, balances.
 */
export const STITCH_AUTHORIZE_URL = 'https://secure.stitch.money/connect/authorize';
export const STITCH_TOKEN_URL = 'https://secure.stitch.money/connect/token';
export const STITCH_SCOPES = ['openid', 'offline_access', 'accounts', 'transactions', 'balances'];

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface LinkOAuthClient {
  buildAuthorizationRequest(): AuthorizationRequest;
  exchangeCode(code: string, codeVerifier: string): Promise<ProviderTokens>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
}

export class OAuthExchangeError extends Error {
  constructor(
    public readonly reason: 'invalid_grant' | 'provider_error',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}

/** URL-safe random string from the RFC 7636 unreserved alphabet. */
export function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface StitchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function loadStitchConfig(env: NodeJS.ProcessEnv = process.env): StitchConfig {
  const clientId = env.STITCH_CLIENT_ID;
  const redirectUri = env.STITCH_REDIRECT_URI;
  if (!clientId || !redirectUri)
    throw new Error('STITCH_CLIENT_ID and STITCH_REDIRECT_URI are required');
  if (!isLocalEnv(env) && !redirectUri.startsWith('https://')) {
    throw new Error('STITCH_REDIRECT_URI must be https outside development');
  }
  return {
    clientId,
    redirectUri,
    clientSecret: requireSecret('STITCH_CLIENT_SECRET', { devFallback: '', minLength: 16 }, env),
  };
}

function toTokens(body: Record<string, unknown>): ProviderTokens {
  if (typeof body.access_token !== 'string')
    throw new OAuthExchangeError('provider_error', 'token response missing access_token');
  const expiresIn = Number(body.expires_in ?? 900);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export class StitchOAuthClient implements LinkOAuthClient {
  constructor(
    private readonly config: StitchConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  buildAuthorizationRequest(): AuthorizationRequest {
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const codeVerifier = randomUrlSafe(48); // 64 chars, within the 43–128 PKCE range
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scope: STITCH_SCOPES.join(' '),
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      nonce,
      state,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    return {
      authorizationUrl: `${STITCH_AUTHORIZE_URL}?${params.toString()}`,
      state,
      codeVerifier,
      nonce,
    };
  }

  private async token(body: Record<string, string>): Promise<ProviderTokens> {
    let response: Response;
    try {
      response = await this.fetchImpl(STITCH_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          ...body,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new OAuthExchangeError('provider_error', 'Stitch token endpoint unreachable');
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const invalid = response.status === 400 && json.error === 'invalid_grant';
      throw new OAuthExchangeError(
        invalid ? 'invalid_grant' : 'provider_error',
        `Stitch token request failed (${response.status})`,
      );
    }
    return toTokens(json);
  }

  exchangeCode(code: string, codeVerifier: string): Promise<ProviderTokens> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  refresh(refreshToken: string): Promise<ProviderTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }
}

/**
 * SYNTHETIC consent flow for development: the "authorization URL" points
 * straight back to the app's callback with a sandbox code.
 */
export class SandboxOAuthClient implements LinkOAuthClient {
  constructor(
    private readonly redirectUri: string = process.env.STITCH_REDIRECT_URI ??
      'http://localhost:3000/bank/callback',
  ) {
    if (!isLocalEnv())
      throw new Error('SandboxOAuthClient is only available in development and test');
  }

  buildAuthorizationRequest(): AuthorizationRequest {
    const state = randomUrlSafe(32);
    const params = new URLSearchParams({ code: `sandbox-${randomUrlSafe(12)}`, state });
    return {
      authorizationUrl: `${this.redirectUri}?${params.toString()}`,
      state,
      codeVerifier: randomUrlSafe(48),
      nonce: randomUrlSafe(32),
    };
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    if (!code.startsWith('sandbox-'))
      throw new OAuthExchangeError('invalid_grant', 'not a sandbox code');
    return {
      accessToken: `sbx-access-${randomUrlSafe(8)}`,
      refreshToken: `sbx-refresh-${randomUrlSafe(8)}`,
      expiresAt: new Date(Date.now() + 900_000),
    };
  }

  async refresh(): Promise<ProviderTokens> {
    return {
      accessToken: `sbx-access-${randomUrlSafe(8)}`,
      refreshToken: `sbx-refresh-${randomUrlSafe(8)}`,
      expiresAt: new Date(Date.now() + 900_000),
    };
  }
}
