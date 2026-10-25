import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withSystem, writeAudit } from '@credisync/db';
import { asyncHandler, requireAuth, requireRole } from '@credisync/middleware';
import { AUDIT_EVENT_TYPES, DISPUTE_STATUSES } from '@credisync/types';
import { forward, forwardBinary } from './proxy';
import type { GatewayConfig } from './app';

/**
 * Internal staff portal API. Every route requires an admin or compliance
 * officer, runs in explicit system context, and writes an `admin_access`
 * audit event naming who looked at what (POPIA s23 access log).
 */
export function createAdminRouter(pool: Pool, config: GatewayConfig): Router {
  const disputeEngineUrl = config.disputeEngineUrl;
  const router = Router();
  router.use(requireAuth, requireRole('admin', 'compliance_officer'));

  const pageParams = (req: Request, max = 50) => {
    const page = Math.max(1, Math.floor(Number(req.query.page ?? 1)) || 1);
    const limit = Math.min(max, Math.max(1, Math.floor(Number(req.query.limit ?? 20)) || 20));
    return { page, limit, offset: (page - 1) * limit };
  };

  const audited = <T>(
    req: Request,
    view: string,
    fn: (client: import('pg').PoolClient) => Promise<T>,
    details: Record<string, unknown> = {},
  ) =>
    withSystem(pool, async (client) => {
      const result = await fn(client);
      await writeAudit(client, {
        userId: null,
        performedBy: req.user!.id,
        eventType: 'admin_access',
        resourceType: 'admin_view',
        payload: { view, ...details },
        ipAddress: req.ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 256),
      });
      return result;
    });

  async function serviceHealth(): Promise<Record<string, string>> {
    const targets: Record<string, string> = {
      auth: config.authUrl,
      bureau_ingestion: config.bureauIngestionUrl,
      dispute_engine: config.disputeEngineUrl,
      open_banking: config.openBankingUrl,
      bank_readiness: config.bankReadinessUrl,
    };
    const entries = await Promise.all(
      Object.entries(targets).map(async ([name, url]) => {
        try {
          const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
          return [name, r.ok ? 'ok' : 'degraded'] as const;
        } catch {
          return [name, 'unreachable'] as const;
        }
      }),
    );
    return { api_gateway: 'ok', ...Object.fromEntries(entries) };
  }

  router.get(
    '/dashboard',
    asyncHandler(async (req, res) => {
      const health = serviceHealth();
      const data = await audited(req, 'dashboard', async (client) => {
        const [users, disputes, profiles] = await Promise.all([
          client.query(
            `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM credisync.users WHERE role = 'consumer'`,
          ),
          client.query(`SELECT
              COUNT(*) FILTER (WHERE status IN ('draft','submitted','under_review')) AS open,
              COUNT(*) FILTER (WHERE status IN ('resolved_upheld','resolved_rejected') AND resolved_at > NOW() - INTERVAL '30 days') AS resolved_30d,
              COUNT(*) FILTER (WHERE deadline_breached_at IS NOT NULL AND status IN ('submitted','under_review')) AS overdue
            FROM credisync.disputes`),
          client.query(
            'SELECT COUNT(*) AS total, AVG(unified_score) AS avg FROM credisync.credit_profiles WHERE is_current',
          ),
        ]);
        return {
          totalUsers: Number(users.rows[0]?.total ?? 0),
          activeUsers: Number(users.rows[0]?.active ?? 0),
          openDisputes: Number(disputes.rows[0]?.open ?? 0),
          resolvedDisputes30d: Number(disputes.rows[0]?.resolved_30d ?? 0),
          overdueDisputes: Number(disputes.rows[0]?.overdue ?? 0),
          totalCreditProfiles: Number(profiles.rows[0]?.total ?? 0),
          averageScore: Math.round(Number(profiles.rows[0]?.avg ?? 0)),
        };
      });
      res.json({ ...data, serviceHealth: await health });
    }),
  );

  router.get(
    '/users',
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = pageParams(req);
      const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const params: unknown[] = [];
      let where = '';
      if (search) {
        // Escape LIKE wildcards so a search for "%" doesn't match everyone.
        params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where = 'WHERE email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1';
      }
      const data = await audited(
        req,
        'users',
        async (client) => {
          const count = await client.query(
            `SELECT COUNT(*) AS total FROM credisync.users ${where}`,
            params,
          );
          const rows = await client.query(
            `SELECT id, email, first_name, last_name, role, is_active, is_verified, created_at, last_login_at
             FROM credisync.users ${where}
             ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
          );
          const total = Number(count.rows[0]?.total ?? 0);
          return { users: rows.rows, total, page, totalPages: Math.ceil(total / limit) };
        },
        { searched: Boolean(search), page },
      );
      res.json(data);
    }),
  );

  router.get(
    '/disputes',
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = pageParams(req);
      const status = z.enum(DISPUTE_STATUSES).safeParse(req.query.status);
      const params: unknown[] = status.success ? [status.data] : [];
      const where = status.success ? 'WHERE d.status = $1' : '';
      const data = await audited(
        req,
        'disputes',
        async (client) => {
          const count = await client.query(
            `SELECT COUNT(*) AS total FROM credisync.disputes d ${where}`,
            params,
          );
          const rows = await client.query(
            `SELECT d.id, d.user_id, d.bureau, d.dispute_reason, d.status, d.created_at, d.submitted_at,
                    d.resolution_deadline, d.deadline_breached_at, d.bureau_reference, ba.creditor_name
             FROM credisync.disputes d JOIN credisync.bureau_accounts ba ON ba.id = d.bureau_account_id
             ${where}
             ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
          );
          const total = Number(count.rows[0]?.total ?? 0);
          return { disputes: rows.rows, total, page, totalPages: Math.ceil(total / limit) };
        },
        { status: status.success ? status.data : null, page },
      );
      res.json(data);
    }),
  );

  router.get(
    '/audit-logs',
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = pageParams(req, 100);
      const event = z.enum(AUDIT_EVENT_TYPES).safeParse(req.query.event);
      const params: unknown[] = event.success ? [event.data] : [];
      const where = event.success ? 'WHERE event_type = $1' : '';
      const data = await audited(
        req,
        'audit_logs',
        async (client) => {
          const count = await client.query(
            `SELECT COUNT(*) AS total FROM credisync.regulatory_audit_logs ${where}`,
            params,
          );
          const rows = await client.query(
            `SELECT id, user_id, performed_by, event_type, resource_type, success, error_message, created_at
             FROM credisync.regulatory_audit_logs ${where}
             ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
          );
          const total = Number(count.rows[0]?.total ?? 0);
          return { logs: rows.rows, total, page, totalPages: Math.ceil(total / limit) };
        },
        { event: event.success ? event.data : null, page },
      );
      res.json(data);
    }),
  );

  // Dispute operations are performed by the dispute engine, attributed to this staff member.
  const disputeId = (req: Request) =>
    z.string().uuid().safeParse(req.params.id).success
      ? req.params.id
      : '00000000-0000-4000-8000-000000000000';
  router.get(
    '/disputes/:id/lodging-letter.pdf',
    asyncHandler((req, res) =>
      forwardBinary(
        disputeEngineUrl,
        `/admin/disputes/${disputeId(req)}/lodging-letter.pdf`,
        req,
        res,
      ),
    ),
  );
  router.post(
    '/disputes/:id/bureau-reference',
    asyncHandler((req, res) =>
      forward(disputeEngineUrl, `/admin/disputes/${disputeId(req)}/bureau-reference`, req, res),
    ),
  );
  router.post(
    '/disputes/:id/bureau-response',
    asyncHandler((req, res) =>
      forward(disputeEngineUrl, `/admin/disputes/${disputeId(req)}/bureau-response`, req, res),
    ),
  );

  return router;
}
