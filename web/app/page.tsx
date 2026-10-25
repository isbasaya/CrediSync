import { AppHeader } from '@/components/AppHeader';
import { CreditProfileDashboard } from '@/components/CreditProfileDashboard';

/**
 * Placeholder entry point. In production this reads the authenticated
 * user's id from the session (see auth middleware, not yet built) rather
 * than a hardcoded value.
 */
export default function DashboardPage() {
  const userId = process.env.NEXT_PUBLIC_DEMO_USER_ID ?? '';

  return (
    <div className="min-h-dvh bg-bg-base">
      <AppHeader />
      <main>
        <CreditProfileDashboard userId={userId} />
      </main>
    </div>
  );
}
