import type { Express } from 'express';

/**
 * Behind an AWS ALB every request arrives from the load balancer's IP, so
 * per-IP rate limiting and audit IPs are meaningless unless Express trusts
 * X-Forwarded-For. TRUST_PROXY is the number of proxy hops in front of the
 * service (1 for a single ALB). Default 0 = trust nothing (safe locally).
 */
export function configureTrustProxy(app: Express, env: NodeJS.ProcessEnv = process.env): void {
  const hops = Number(env.TRUST_PROXY ?? 0);
  app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : false);
}
