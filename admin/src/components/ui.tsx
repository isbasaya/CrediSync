import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  icon,
  children,
  className = '',
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border-default bg-bg-surface p-5 shadow-sm ${className}`}>
      {title && (
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-text-primary">
          {icon}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}) {
  const tones = {
    neutral: 'text-text-primary',
    positive: 'text-status-good-fg',
    warning: 'text-status-fair-fg',
    negative: 'text-status-very-poor-fg',
  };
  const iconTones = {
    neutral: 'bg-teal-050 text-teal-700',
    positive: 'bg-status-good-bg text-status-good-fg',
    warning: 'bg-status-fair-bg text-status-fair-fg',
    negative: 'bg-status-very-poor-bg text-status-very-poor-fg',
  };

  return (
    <Card className="transition-colors duration-normal hover:border-teal-700">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
        {icon && <span className={`flex h-7 w-7 items-center justify-center rounded-md ${iconTones[tone]}`}>{icon}</span>}
      </div>
      <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
    </Card>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative' | 'info';
}) {
  const tones = {
    neutral: 'bg-bg-muted text-text-secondary',
    positive: 'bg-status-good-bg text-status-good-fg',
    warning: 'bg-status-fair-bg text-status-fair-fg',
    negative: 'bg-status-very-poor-bg text-status-very-poor-fg',
    info: 'bg-teal-050 text-teal-800',
  };

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ columns, rows, loading }: { columns: string[]; rows: ReactNode[][]; loading?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle">
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  {columns.map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3.5 w-full max-w-[10rem] animate-pulse rounded bg-bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle transition-colors duration-fast hover:bg-bg-muted">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 text-text-primary">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {icon && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-muted text-text-muted">{icon}</span>}
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-between">
      <span className="text-xs text-text-muted">
        Page {page} of {Math.max(totalPages, 1)}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border-default bg-bg-surface px-3 py-1 text-sm text-text-secondary transition-colors duration-fast hover:border-teal-700 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border-default bg-bg-surface px-3 py-1 text-sm text-text-secondary transition-colors duration-fast hover:border-teal-700 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
