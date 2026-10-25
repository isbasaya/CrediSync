/**
 * Secrets must come from the environment (AWS Secrets Manager in deployed
 * environments). Development and test may use a clearly-labelled fallback;
 * any other NODE_ENV refuses to start without a real value, so a forgotten
 * variable can never silently fall back to a well-known default.
 */
const LOCAL_ENVS = new Set(['development', 'test']);

export class MissingSecretError extends Error {
  constructor(name: string, reason: string) {
    super(`Secret ${name} ${reason}`);
    this.name = 'MissingSecretError';
  }
}

export interface SecretOptions {
  /** Used only when NODE_ENV is development or test. */
  devFallback: string;
  minLength?: number;
}

const warned = new Set<string>();

export function isLocalEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return LOCAL_ENVS.has(env.NODE_ENV ?? 'development');
}

export function requireSecret(name: string, options: SecretOptions, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  const minLength = options.minLength ?? 32;

  if (value && value.length > 0) {
    if (!isLocalEnv(env) && value.length < minLength) {
      throw new MissingSecretError(name, `must be at least ${minLength} characters outside development`);
    }
    if (!isLocalEnv(env) && (value === options.devFallback || /change[-_]?me/i.test(value))) {
      throw new MissingSecretError(name, 'is still set to a development placeholder');
    }
    return value;
  }

  if (!isLocalEnv(env)) {
    throw new MissingSecretError(name, `is required when NODE_ENV=${env.NODE_ENV}`);
  }

  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[config] ${name} not set — using development fallback (never valid outside development/test)`);
  }
  return options.devFallback;
}
