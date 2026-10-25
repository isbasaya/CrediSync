import { isLocalEnv, requireSecret } from '@credisync/config';
import { hmacLookup, KmsKeyProvider, LocalKeyProvider } from '@credisync/crypto';
import { internalServiceToken } from './internal-auth';
import { jwtSecret } from './jwt';

export interface StartupRequirements {
  jwt?: boolean;
  hmac?: boolean;
  encryption?: boolean;
  database?: boolean;
}

/**
 * Checks every secret a service needs before it starts listening, so a
 * misconfigured deployment fails at boot instead of on the first request.
 * Outside development/test, missing or placeholder secrets throw.
 */
export function verifyStartupConfig(
  req: StartupRequirements,
  env: NodeJS.ProcessEnv = process.env,
): void {
  internalServiceToken(env);
  if (req.jwt) jwtSecret(env);
  if (req.hmac) hmacLookup('startup-probe', env);
  if (req.encryption) {
    if (env.KMS_KEY_ID) new KmsKeyProvider(env.KMS_KEY_ID, env.AWS_REGION ?? 'af-south-1');
    else new LocalKeyProvider(env);
  }
  if (req.database && !isLocalEnv(env)) {
    requireSecret('DATABASE_URL', { devFallback: '', minLength: 10 }, env);
  }
}
