'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { LogoMark } from './icons';

const NAV = [
  { href: '/', label: 'Credit profile' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/privacy', label: 'Privacy' },
];

export function AppHeader() {
  const { me, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-text-primary">
          <LogoMark className="h-6 w-6 text-teal-700" />
          <span className="text-sm font-semibold tracking-tight">CrediSync</span>
        </Link>
        {me && (
          <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto text-sm">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium transition-colors duration-fast ${
                    active ? 'bg-teal-050 text-teal-800' : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace('/login');
              }}
              className="ml-1 cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium text-text-muted transition-colors duration-fast hover:text-text-primary"
            >
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
