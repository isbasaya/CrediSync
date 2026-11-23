'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Badge, Card, EmptyState, LoadError, PageHeader, Pagination, Table } from '@/components/ui';
import { api } from '@/lib/api-client';
import { InboxIcon } from '@/components/icons';

interface AuditLog {
  id: number;
  user_id: string;
  event_type: string;
  resource_type: string;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
}

export default function AuditLogsPage() {
  return (
    <Suspense>
      <AuditLogsPageInner />
    </Suspense>
  );
}

function AuditLogsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [eventFilter, setEventFilter] = useState(searchParams.get('event') ?? '');

  const page = Number(searchParams.get('page') ?? '1');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams();
    if (eventFilter) params.set('event', eventFilter);
    params.set('page', String(page));

    try {
      const result = await api.get<AuditLogsResponse>(`/admin/audit-logs?${params.toString()}`);
      setData(result);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [eventFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <RequireAuth>
      <AdminLayout>
        <div className="space-y-6">
          <PageHeader title="Audit Logs" subtitle="Regulatory audit trail (POPIA Section 22/23)" />

          <Card>
            <div className="mb-4 flex gap-3">
              <select
                value={eventFilter}
                onChange={(e) => {
                  setEventFilter(e.target.value);
                  const params = new URLSearchParams();
                  if (e.target.value) params.set('event', e.target.value);
                  router.push(`/audit-logs?${params.toString()}`);
                }}
                className="cursor-pointer rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary transition-colors duration-fast focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              >
                <option value="">All events</option>
                <option value="user_registered">User Registered</option>
                <option value="user_login">User Login</option>
                <option value="consent_granted">Consent Granted</option>
                <option value="consent_revoked">Consent Revoked</option>
                <option value="data_access">Data Access</option>
                <option value="bureau_pull">Bureau Pull</option>
                <option value="dispute_created">Dispute Created</option>
                <option value="dispute_submitted">Dispute Submitted</option>
              </select>
            </div>

            {loading ? (
              <Table
                columns={['Event', 'Resource', 'User', 'Success', 'Timestamp']}
                rows={[]}
                loading
              />
            ) : loadFailed ? (
              <LoadError
                message="Couldn’t load the audit log. This doesn’t mean there are no entries."
                onRetry={() => void fetchLogs()}
              />
            ) : data && data.logs.length > 0 ? (
              <>
                <Table
                  columns={['Event', 'Resource', 'User', 'Success', 'Timestamp']}
                  rows={data.logs.map((log) => [
                    <span key="event" className="text-text-primary">
                      {log.event_type.replace(/_/g, ' ')}
                    </span>,
                    <span key="resource" className="text-text-muted">
                      {log.resource_type}
                    </span>,
                    <span key="user" className="font-mono text-xs text-text-muted">
                      {log.user_id.slice(0, 8)}...
                    </span>,
                    <Badge key="success" tone={log.success ? 'positive' : 'negative'}>
                      {log.success ? 'Success' : 'Failed'}
                    </Badge>,
                    <span key="time" className="font-mono text-xs tabular-nums text-text-muted">
                      {new Date(log.created_at).toLocaleString()}
                    </span>,
                  ])}
                />
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onPageChange={(p) => {
                    const params = new URLSearchParams();
                    if (eventFilter) params.set('event', eventFilter);
                    params.set('page', String(p));
                    router.push(`/audit-logs?${params.toString()}`);
                  }}
                />
              </>
            ) : (
              <EmptyState icon={<InboxIcon className="h-5 w-5" />} message="No audit logs found" />
            )}
          </Card>
        </div>
      </AdminLayout>
    </RequireAuth>
  );
}
