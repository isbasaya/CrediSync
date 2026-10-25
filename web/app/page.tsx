import { AppHeader } from '@/components/AppHeader';
import { CreditProfileDashboard } from '@/components/CreditProfileDashboard';
import { RequireSession } from '@/lib/session';

export default function DashboardPage() {
  return (
    <div className="min-h-dvh bg-bg-base">
      <AppHeader />
      <main>
        <RequireSession>
          <CreditProfileDashboard />
        </RequireSession>
      </main>
    </div>
  );
}
