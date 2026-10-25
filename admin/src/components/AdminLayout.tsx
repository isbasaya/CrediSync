'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  GavelIcon,
  HomeIcon,
  InboxIcon,
  LogoMark,
  LogoutIcon,
  MenuIcon,
  UsersIcon,
  XIcon,
} from './icons';

const navItems = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/users', label: 'Users', icon: UsersIcon },
  { href: '/disputes', label: 'Disputes', icon: GavelIcon },
  { href: '/audit-logs', label: 'Audit Logs', icon: InboxIcon },
];

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-2 pb-8 pt-1">
        <LogoMark className="h-6 w-6 text-teal-700" />
        <div>
          <h1 className="text-sm font-semibold leading-tight text-text-primary">CrediSync Admin</h1>
          <p className="text-xs leading-tight text-text-muted">Operations Portal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-fast ${
                active
                  ? 'bg-teal-050 text-teal-800'
                  : 'text-text-secondary hover:bg-bg-muted hover:text-text-primary'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-teal-700' : ''}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border-subtle pt-4">
        <div className="mb-2 truncate px-3 text-xs text-text-muted">{user?.email}</div>
        <button
          onClick={logout}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-bg-muted hover:text-text-primary"
        >
          <LogoutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border-subtle bg-bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <LogoMark className="h-5 w-5 text-teal-700" />
          <span className="text-sm font-semibold text-text-primary">CrediSync Admin</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="cursor-pointer rounded-md p-2 text-text-secondary hover:bg-bg-muted hover:text-text-primary"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-fade-in border-r border-border-default bg-bg-surface p-4">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-3 cursor-pointer rounded-md p-1.5 text-text-secondary hover:bg-bg-muted hover:text-text-primary"
            >
              <XIcon className="h-5 w-5" />
            </button>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border-default bg-bg-surface p-4 lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
