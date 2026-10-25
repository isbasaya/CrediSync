import { Router, type Request, type Response } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from './middleware';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const adminRouter = Router();

adminRouter.use(authMiddleware);

adminRouter.get('/dashboard', async (_req: Request, res: Response) => {
  const [users, disputes, profiles, health] = await Promise.all([
    pool.query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active = TRUE) AS active FROM credisync.users'),
    pool.query("SELECT COUNT(*) AS open FROM credisync.disputes WHERE status IN ('draft','submitted','under_review')"),
    pool.query('SELECT COUNT(*) AS total, AVG(unified_score) AS avg FROM credisync.credit_profiles'),
    Promise.resolve({ rows: [{ api_gateway: 'ok', bureau_ingestion: 'unknown', dispute_engine: 'unknown', open_banking: 'unknown' }] }),
  ]);

  res.json({
    totalUsers: Number(users.rows[0]?.total ?? 0),
    activeUsers: Number(users.rows[0]?.active ?? 0),
    openDisputes: Number(disputes.rows[0]?.open ?? 0),
    resolvedDisputes30d: 0,
    totalCreditProfiles: Number(profiles.rows[0]?.total ?? 0),
    averageScore: Math.round(Number(profiles.rows[0]?.avg ?? 0)),
    serviceHealth: health.rows[0],
  });
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const offset = (page - 1) * limit;
  const search = (req.query.q as string | undefined)?.trim();

  let where = '';
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where = 'WHERE email ILIKE $1 OR first_name ILIKE $2 OR last_name ILIKE $3';
  }

  const countResult = await pool.query(`SELECT COUNT(*) AS total FROM credisync.users ${where}`, params);
  const total = Number(countResult.rows[0]?.total ?? 0);

  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT id, email, first_name, last_name, is_active, is_verified, created_at, last_login_at
     FROM credisync.users ${where}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  res.json({
    users: dataResult.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

adminRouter.get('/disputes', async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const offset = (page - 1) * limit;
  const status = (req.query.status as string | undefined)?.trim();

  let where = '';
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }

  const countResult = await pool.query(`SELECT COUNT(*) AS total FROM credisync.disputes ${where}`, params);
  const total = Number(countResult.rows[0]?.total ?? 0);

  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT id, user_id, bureau, dispute_reason, status, created_at, resolution_deadline
     FROM credisync.disputes ${where}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  res.json({
    disputes: dataResult.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

adminRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
  const offset = (page - 1) * limit;
  const eventType = (req.query.event as string | undefined)?.trim();

  let where = '';
  const params: unknown[] = [];
  if (eventType) {
    params.push(eventType);
    where = 'WHERE event_type = $1';
  }

  const countResult = await pool.query(`SELECT COUNT(*) AS total FROM credisync.regulatory_audit_logs ${where}`, params);
  const total = Number(countResult.rows[0]?.total ?? 0);

  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT id, user_id, event_type, resource_type, success, error_message, created_at
     FROM credisync.regulatory_audit_logs ${where}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams
  );

  res.json({
    logs: dataResult.rows,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});
