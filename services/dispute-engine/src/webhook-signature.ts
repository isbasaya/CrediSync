import { createHmac } from 'crypto';
import { requireSecret } from '@credisync/config';
import { safeEqual } from '@credisync/crypto';
import type { BureauSource } from './types';

/**
 * Bureau webhooks are signed with a per-bureau shared secret:
 *
 *   X-CrediSync-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * The timestamp is part of the signed payload and must be within
 * TOLERANCE_SECONDS, so a captured request can't be replayed later
 * (event ids are also de-duplicated in dispute_webhook_events).
 */
export const SIGNATURE_HEADER = 'x-credisync-signature';
export const TOLERANCE_SECONDS = 300;

export function webhookSecret(bureau: BureauSource, env: NodeJS.ProcessEnv = process.env): string {
  return requireSecret(`BUREAU_WEBHOOK_SECRET_${bureau.toUpperCase()}`, { devFallback: `dev-webhook-secret-${bureau}-local-only-xxxxxxxx` }, env);
}

export function signWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verifyWebhookSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || Math.abs(now - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return safeEqual(expected, v1);
}
