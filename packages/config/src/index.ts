import { z } from 'zod';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function parseBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(env);
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development';
}
