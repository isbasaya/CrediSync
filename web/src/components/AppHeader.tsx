import { LogoMark } from './icons';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2 text-text-primary">
          <LogoMark className="h-6 w-6 text-teal-700" />
          <span className="text-sm font-semibold tracking-tight">CrediSync</span>
        </div>
        <span className="hidden text-sm font-medium text-text-muted sm:inline">Credit Profile</span>
      </div>
    </header>
  );
}
