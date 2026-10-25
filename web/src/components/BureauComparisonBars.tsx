import { scoreBandTokens, getScoreBand } from '../../../design-system/tokens';
import type { BureauScore } from '../lib/types';

const BUREAU_LABELS: Record<BureauScore['bureau'], string> = {
  transunion: 'TransUnion',
  experian: 'Experian',
  xds: 'XDS',
};

const MAX_SCORE = 999;

/**
 * Custom multi-bureau comparison bars — plain divs, no chart library.
 * Each bar's fill color follows that bureau's own score band so a
 * consumer can immediately see which bureau is dragging their profile
 * down, not just the numbers.
 */
export function BureauComparisonBars({ scores }: { scores: BureauScore[] }) {
  return (
    <div className="flex flex-col gap-3">
      {scores.map((entry) => {
        const hasScore = entry.score !== null;
        const band = hasScore ? getScoreBand(entry.score!) : null;
        const tokens = band ? scoreBandTokens[band] : null;
        const widthPct = hasScore ? Math.max(4, (entry.score! / MAX_SCORE) * 100) : 0;

        return (
          <div key={entry.bureau} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-sm font-medium text-text-secondary">
              {BUREAU_LABELS[entry.bureau]}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-bg-muted">
              {hasScore && (
                <div
                  className="h-full rounded-full transition-[width] duration-slow ease-default"
                  style={{ width: `${widthPct}%`, backgroundColor: tokens!.icon }}
                />
              )}
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-text-primary">
              {hasScore ? entry.score : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
