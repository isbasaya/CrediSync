'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Badge, Card, EmptyState, LoadError, PageHeader, Pagination, Table } from '@/components/ui';
import { api, ApiError, API_BASE_URL } from '@/lib/api-client';
import { GavelIcon } from '@/components/icons';

interface Dispute {
  id: string;
  user_id: string;
  bureau: string;
  dispute_reason: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  resolution_deadline: string | null;
  deadline_breached_at: string | null;
  bureau_reference: string | null;
  creditor_name: string;
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

const COLUMNS = ['ID', 'Account', 'Reason', 'Status', 'Created', 'Deadline', 'Bureau ref', ''];

/**
 * Disputes are lodged with bureaus by the operations team until bureau
 * dispute APIs are contracted. Staff record the bureau's reference when
 * lodging, and the bureau's response when it arrives. Every action is
 * attributed to the signed-in staff member in the audit log.
 */
function DisputeUpdatePanel({
  dispute,
  onClose,
  onSaved,
}: {
  dispute: Dispute;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(dispute.bureau_reference ?? '');
  const [response, setResponse] = useState('');
  const [resolution, setResolution] = useState<'' | 'upheld' | 'rejected'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20';

  return (
    <Card
      title={`Update dispute ${dispute.id.slice(0, 8)} · ${dispute.creditor_name} (${dispute.bureau})`}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.post(`/admin/disputes/${dispute.id}/bureau-reference`, {
                bureauReference: reference,
              }),
            );
          }}
        >
          <label htmlFor="ref" className="block text-sm font-medium text-text-primary">
            Bureau reference number
          </label>
          <input
            id="ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={input}
            required
            maxLength={100}
          />
          <button
            type="submit"
            disabled={busy || !reference.trim()}
            className="cursor-pointer rounded-lg border border-border-default px-3 py-2 text-sm font-semibold text-text-primary hover:border-teal-700 disabled:opacity-50"
          >
            Save reference
          </button>
        </form>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.post(`/admin/disputes/${dispute.id}/bureau-response`, {
                response,
                reference: reference.trim() || null,
                resolution: resolution || null,
              }),
            );
          }}
        >
          <label htmlFor="response" className="block text-sm font-medium text-text-primary">
            Bureau response
          </label>
          <textarea
            id="response"
            rows={3}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            className={input}
            required
          />
          <label htmlFor="resolution" className="block text-sm font-medium text-text-primary">
            Outcome
          </label>
          <select
            id="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as typeof resolution)}
            className={input}
          >
            <option value="">Still investigating</option>
            <option value="upheld">Upheld — record corrected</option>
            <option value="rejected">Rejected — record confirmed</option>
          </select>
          <button
            type="submit"
            disabled={busy || !response.trim()}
            className="cursor-pointer rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            Record response
          </button>
        </form>
      </div>
      <p className="mt-4 text-sm text-text-secondary">
        <a
          href={`${API_BASE_URL}/admin/disputes/${dispute.id}/lodging-letter.pdf`}
          className="font-semibold text-teal-700 hover:text-teal-800"
        >
          Download lodging letter (PDF)
        </a>{' '}
        — contains the consumer’s full ID number. Downloads are logged against your account.
      </p>
      {error && <p className="mt-4 text-sm font-medium text-status-very-poor-fg">{error}</p>}
      <button
        type="button"
        onClick={onClose}
        className="mt-4 cursor-pointer text-sm text-text-muted hover:text-text-primary"
      >
        Close
      </button>
    </Card>
  );
}

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');

  const page = Number(searchParams.get('page') ?? '1');

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    params.set('page', String(page));

    try {
      const result = await api.get<DisputesResponse>(`/admin/disputes?${params.toString()}`);
      setData(result);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const [selected, setSelected] = useState<Dispute | null>(null);

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
              <Table columns={COLUMNS} rows={[]} loading />
            ) : loadFailed ? (
              <LoadError
                message="Couldn’t load disputes. There may still be disputes that need attention."
                onRetry={() => void fetchDisputes()}
              />
            ) : data && data.disputes.length > 0 ? (
              <>
                <Table
                  columns={COLUMNS}
                  rows={data.disputes.map((d) => [
                    <span key="id" className="font-mono text-xs text-text-muted">
                      {d.id.slice(0, 8)}...
                    </span>,
                    <span key="account" className="text-text-primary">
                      {d.creditor_name}{' '}
                      <span className="capitalize text-text-muted">· {d.bureau}</span>
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
                    <span
                      key="deadline"
                      className={`font-mono text-xs tabular-nums ${d.deadline_breached_at ? 'font-semibold text-status-very-poor-fg' : 'text-text-muted'}`}
                    >
                      {d.resolution_deadline
                        ? new Date(d.resolution_deadline).toLocaleDateString()
                        : '—'}
                      {d.deadline_breached_at ? ' · overdue' : ''}
                    </span>,
                    <span key="ref" className="font-mono text-xs text-text-muted">
                      {d.bureau_reference ?? '—'}
                    </span>,
                    d.status === 'submitted' || d.status === 'under_review' ? (
                      <button
                        key="action"
                        type="button"
                        onClick={() => setSelected(d)}
                        className="cursor-pointer text-sm font-semibold text-teal-700 hover:text-teal-800"
                      >
                        Record update
                      </button>
                    ) : (
                      <span key="action" />
                    ),
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

          {selected && (
            <DisputeUpdatePanel
              key={selected.id}
              dispute={selected}
              onClose={() => setSelected(null)}
              onSaved={() => {
                setSelected(null);
                void fetchDisputes();
              }}
            />
          )}
        </div>
      </AdminLayout>
    </RequireAuth>
  );
}
