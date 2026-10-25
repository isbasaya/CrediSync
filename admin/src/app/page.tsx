'use client';

import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { api } from '@/lib/api-client';
import { CheckCircleIcon, GavelIcon, InboxIcon, PulseIcon, UsersIcon } from '@/components/icons';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  openDisputes: number;
  resolvedDisputes30d: number;
  overdueDisputes: number;
  totalCreditProfiles: number;
  averageScore: number;
  serviceHealth: Record<string, string>;
}

const healthTone: Record<string, 'positive' | 'warning' | 'negative'> = {
  ok: 'positive',
  degraded: 'warning',
  unreachable: 'negative',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardStats>('/admin/dashboard')
      .then(setStats)
      .catch(() => {
        setStats({
          totalUsers: 0,
          activeUsers: 0,
          openDisputes: 0,
          resolvedDisputes30d: 0,
          overdueDisputes: 0,
          totalCreditProfiles: 0,
          averageScore: 0,
          serviceHealth: {},
        });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <RequireAuth>
      <AdminLayout>
        <div className="space-y-6">
          <PageHeader title="Dashboard" subtitle="System overview and key metrics" />

          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl border border-border-default bg-bg-muted" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total Users" value={stats?.totalUsers ?? 0} icon={<UsersIcon className="h-4 w-4" />} />
                <StatCard
                  label="Active Users"
                  value={stats?.activeUsers ?? 0}
                  tone="positive"
                  icon={<CheckCircleIcon className="h-4 w-4" />}
                />
                <StatCard
                  label="Open Disputes"
                  value={stats?.openDisputes ?? 0}
                  tone="warning"
                  icon={<GavelIcon className="h-4 w-4" />}
                />
                <StatCard label="Avg Credit Score" value={stats?.averageScore ?? '—'} icon={<PulseIcon className="h-4 w-4" />} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card title="Service Health">
                  <div className="space-y-2">
                    {Object.keys(stats?.serviceHealth ?? {}).length === 0 && (
                      <p className="text-sm text-text-muted">No service health data available.</p>
                    )}
                    {Object.entries(stats?.serviceHealth ?? {}).map(([name, status]) => (
                      <div key={name} className="flex items-center justify-between py-1">
                        <span className="text-sm capitalize text-text-secondary">{name.replace(/_/g, ' ')}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            (healthTone[status] ?? 'negative') === 'positive'
                              ? 'bg-status-good-bg text-status-good-fg'
                              : (healthTone[status] ?? 'negative') === 'warning'
                                ? 'bg-status-fair-bg text-status-fair-fg'
                                : 'bg-status-very-poor-bg text-status-very-poor-fg'
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Recent Activity" icon={<InboxIcon className="h-4 w-4 text-text-muted" />}>
                  <div className="space-y-2 text-sm text-text-muted">
                    <p>Resolved disputes (30d): {stats?.resolvedDisputes30d ?? 0}</p>
                    <p className={stats?.overdueDisputes ? 'font-semibold text-status-fair-fg' : undefined}>
                      Disputes past the bureau deadline: {stats?.overdueDisputes ?? 0}
                    </p>
                    <p>Credit profiles: {stats?.totalCreditProfiles ?? 0}</p>
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </AdminLayout>
    </RequireAuth>
  );
}
