'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/AdminLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Badge, Card, EmptyState, LoadError, PageHeader, Pagination, Table } from '@/components/ui';
import { api } from '@/lib/api-client';
import { SearchIcon, UsersIcon } from '@/components/icons';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  totalPages: number;
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersPageInner />
    </Suspense>
  );
}

function UsersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const page = Number(searchParams.get('page') ?? '1');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    params.set('page', String(page));

    try {
      const result = await api.get<UsersResponse>(`/admin/users?${params.toString()}`);
      setData(result);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    router.push(`/users?${params.toString()}`);
  }

  return (
    <RequireAuth>
      <AdminLayout>
        <div className="space-y-6">
          <PageHeader title="Users" subtitle="Manage registered users" />

          <Card>
            <form onSubmit={handleSearch} className="mb-4 flex gap-3">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email or name..."
                  className="w-full rounded-lg border border-border-default bg-bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors duration-fast focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
              <button
                type="submit"
                className="cursor-pointer rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-hover"
              >
                Search
              </button>
            </form>

            {loading ? (
              <Table
                columns={['Name', 'Email', 'Status', 'Verified', 'Joined']}
                rows={[]}
                loading
              />
            ) : loadFailed ? (
              <LoadError
                message="Couldn’t load users. This doesn’t mean there are none."
                onRetry={() => void fetchUsers()}
              />
            ) : data && data.users.length > 0 ? (
              <>
                <Table
                  columns={['Name', 'Email', 'Status', 'Verified', 'Joined']}
                  rows={data.users.map((user) => [
                    <span key="name">
                      {user.first_name} {user.last_name}
                    </span>,
                    <span key="email" className="text-text-muted">
                      {user.email}
                    </span>,
                    <Badge key="status" tone={user.is_active ? 'positive' : 'negative'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>,
                    <Badge key="verified" tone={user.is_verified ? 'positive' : 'neutral'}>
                      {user.is_verified ? 'Yes' : 'No'}
                    </Badge>,
                    <span key="joined" className="font-mono text-xs tabular-nums text-text-muted">
                      {new Date(user.created_at).toLocaleDateString()}
                    </span>,
                  ])}
                />
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onPageChange={(p) => {
                    const params = new URLSearchParams();
                    if (search) params.set('q', search);
                    params.set('page', String(p));
                    router.push(`/users?${params.toString()}`);
                  }}
                />
              </>
            ) : (
              <EmptyState icon={<UsersIcon className="h-5 w-5" />} message="No users found" />
            )}
          </Card>
        </div>
      </AdminLayout>
    </RequireAuth>
  );
}
