import { scoreBandTokens, type ScoreBand } from '../../../design-system/tokens';

export function ScoreBandBadge({ band }: { band: ScoreBand }) {
  const tokens = scoreBandTokens[band];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tracking-wide"
      style={{ backgroundColor: tokens.bg, color: tokens.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tokens.icon }} />
      {tokens.label}
    </span>
  );
}
