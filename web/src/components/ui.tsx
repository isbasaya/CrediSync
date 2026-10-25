import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** Small set of form primitives shared by the sign-in, dispute and privacy screens. */

export function Field({
  label,
  hint,
  error,
  id,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  id: string;
}) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className="h-11 rounded-lg border border-border-default bg-bg-surface px-3 text-base text-text-primary placeholder:text-text-muted focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20 aria-[invalid=true]:border-status-very-poor-fg"
        {...input}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-status-very-poor-fg">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  id,
  label,
  children,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-border-default accent-teal-700"
        {...input}
      />
      <label htmlFor={id} className="cursor-pointer text-sm text-text-secondary">
        <span className="font-medium text-text-primary">{label}</span>
        {children && <span className="mt-0.5 block">{children}</span>}
      </label>
    </div>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
}) {
  const styles = {
    primary: 'bg-brand-primary text-white hover:bg-brand-hover',
    secondary:
      'border border-border-default bg-bg-surface text-text-primary hover:border-teal-700 hover:text-teal-800',
    danger:
      'border border-status-very-poor-fg/40 bg-bg-surface text-status-very-poor-fg hover:bg-status-very-poor-bg',
  }[variant];
  return (
    <button
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors duration-normal disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {busy && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
}) {
  const styles = {
    info: 'border-teal-200 bg-teal-050 text-text-secondary',
    error: 'border-status-very-poor-fg/25 bg-status-very-poor-bg text-status-very-poor-fg',
    success: 'border-status-current-fg/25 bg-status-current-bg text-status-current-fg',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function PageShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
        {intro && <p className="mt-2 text-sm text-text-secondary">{intro}</p>}
      </div>
      {children}
    </main>
  );
}
