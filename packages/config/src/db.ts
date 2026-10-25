import { z } from 'zod';

const dbEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;

export function parseDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  return dbEnvSchema.parse(env);
}
