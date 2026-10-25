'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Badge, Card, EmptyState, PageHeader, Pagination, Table } from '@/components/ui';
import { api } from '@/lib/api-client';
import { GavelIcon } from '@/components/icons';

interface Dispute {
  id: string;
  user_id: string;
  bureau: string;
  dispute_reason: string;
  status: string;
  created_at: string;
  resolution_deadline: string | null;
}

interface DisputesResponse {
  disputes: Dispute[];
  total: number;
  page: number;
  totalPages: number;
}

const statusTone: Record<string, 'positive' | 'warning' | 'negative' | 'info' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'info',
  under_review: 'warning',
  resolved_upheld: 'positive',
  resolved_rejected: 'negative',
  escalated_ncr: 'warning',
};

export default function DisputesPage() {
  return (
    <Suspense>
      <DisputesPageInner />
    </Suspense>
  );
}

function DisputesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DisputesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');

  const page = Number(searchParams.get('page') ?? '1');

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    params.set('page', String(page));

    try {
      const result = await api.get<DisputesResponse>(`/admin/disputes?${params.toString()}`);
      setData(result);
    } catch {
      setData({ disputes: [], total: 0, page: 1, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  return (
    <RequireAuth>
      <AdminLayout>
        <div className="space-y-6">
          <PageHeader title="Disputes" subtitle="Monitor and manage credit bureau disputes" />

          <Card>
            <div className="mb-4 flex gap-3">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  const params = new URLSearchParams();
                  if (e.target.value) params.set('status', e.target.value);
                  router.push(`/disputes?${params.toString()}`);
                }}
                className="cursor-pointer rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary transition-colors duration-fast focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="resolved_upheld">Resolved (Upheld)</option>
                <option value="resolved_rejected">Resolved (Rejected)</option>
                <option value="escalated_ncr">Escalated to NCR</option>
              </select>
            </div>

            {loading ? (
              <Table columns={['ID', 'Bureau', 'Reason', 'Status', 'Created', 'Deadline']} rows={[]} loading />
            ) : data && data.disputes.length > 0 ? (
              <>
                <Table
                  columns={['ID', 'Bureau', 'Reason', 'Status', 'Created', 'Deadline']}
                  rows={data.disputes.map((d) => [
                    <span key="id" className="font-mono text-xs text-text-muted">
                      {d.id.slice(0, 8)}...
                    </span>,
                    <span key="bureau" className="capitalize text-text-primary">
                      {d.bureau}
                    </span>,
                    <span key="reason" className="text-text-secondary">
                      {d.dispute_reason.replace(/_/g, ' ')}
                    </span>,
                    <Badge key="status" tone={statusTone[d.status] ?? 'neutral'}>
                      {d.status.replace(/_/g, ' ')}
                    </Badge>,
                    <span key="created" className="font-mono text-xs tabular-nums text-text-muted">
                      {new Date(d.created_at).toLocaleDateString()}
                    </span>,
                    <span key="deadline" className="font-mono text-xs tabular-nums text-text-muted">
                      {d.resolution_deadline ? new Date(d.resolution_deadline).toLocaleDateString() : '—'}
                    </span>,
                  ])}
                />
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onPageChange={(p) => {
                    const params = new URLSearchParams();
                    if (statusFilter) params.set('status', statusFilter);
                    params.set('page', String(p));
                    router.push(`/disputes?${params.toString()}`);
                  }}
                />
              </>
            ) : (
              <EmptyState icon={<GavelIcon className="h-5 w-5" />} message="No disputes found" />
            )}
          </Card>
        </div>
      </AdminLayout>
    </RequireAuth>
  );
}
