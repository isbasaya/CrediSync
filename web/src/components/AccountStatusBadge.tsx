import { accountStatusTokens, type AccountStatus } from '../../../design-system/tokens';

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const tokens = accountStatusTokens[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tokens.bg, color: tokens.fg, boxShadow: tokens.border ? `inset 0 0 0 1px ${tokens.border}` : undefined }}
    >
      {tokens.label}
    </span>
  );
}
