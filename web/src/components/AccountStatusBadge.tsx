import { accountStatusTokens, type AccountStatus } from '../../../design-system/tokens';

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const tokens = accountStatusTokens[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tokens.bg, color: tokens.fg }}
    >
      {tokens.label}
    </span>
  );
}
