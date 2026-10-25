import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { GavelIcon } from '@/components/icons';

/**
 * Entry point for account disputes. The dispute-engine service and its
 * guided flow aren't built yet (see PRODUCT.md — pre-launch); this page
 * is the honest placeholder so "Dispute" is a real destination rather
 * than a dead link, not a simulation of a flow that doesn't exist.
 */
export default function NewDisputePage() {
  return (
    <div className="min-h-dvh bg-bg-base">
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-050 text-teal-700">
          <GavelIcon className="h-5 w-5" />
        </span>
        <h1 className="text-xl font-semibold text-text-primary">Guided dispute filing is coming soon</h1>
        <p className="max-w-md text-sm text-text-secondary">
          We&apos;re building a guided flow to help you dispute incorrect items directly with the bureau. It isn&apos;t
          live yet — in the meantime, our team can help you start the process.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors duration-normal hover:border-teal-700 hover:text-teal-800"
        >
          Back to your credit profile
        </Link>
      </main>
    </div>
  );
}
