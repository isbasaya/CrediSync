import type { Request, Response } from 'express';
import type { Pool } from 'pg';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  checks: {
    database: 'connected' | 'disconnected' | 'unknown';
  };
}

export async function healthCheck(pool: Pool | null, res: Response): Promise<void> {
  const result: HealthCheckResult = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: 'unknown',
    },
  };

  if (pool) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      result.checks.database = 'connected';
    } catch {
      result.checks.database = 'disconnected';
      result.status = 'degraded';
    }
  }

  const statusCode = result.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(result);
}

export function createHealthHandler(pool: Pool | null) {
  return (_req: Request, res: Response) => healthCheck(pool, res);
}
