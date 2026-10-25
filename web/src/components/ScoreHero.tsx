import { scoreBandTokens, type ScoreBand } from '../../../design-system/tokens';
import type { BureauScore } from '../lib/types';
import { RefreshIcon } from './icons';

const BUREAU_LABELS: Record<BureauScore['bureau'], string> = {
  transunion: 'TransUnion',
  experian: 'Experian',
  xds: 'XDS',
};

const BUREAU_INITIALS: Record<BureauScore['bureau'], string> = {
  transunion: 'TU',
  experian: 'EX',
  xds: 'XD',
};

export interface ScoreHeroProps {
  score: number | null;
  band: ScoreBand | null;
  bureauScores: BureauScore[];
  lastRefreshedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * The signature moment: three bureau readings settle in first, then the
 * unified score assembles a beat behind them — orchestration made visible
 * instead of asserted. No gauge, no ring; the numeral itself carries it.
 */
export function ScoreHero({
  score,
  band,
  bureauScores,
  lastRefreshedAt,
  refreshing,
  onRefresh,
}: ScoreHeroProps) {
  const tokens = band ? scoreBandTokens[band] : null;
  const syncedBureaus = bureauScores.filter((b) => b.score !== null).length;

  return (
    // Deliberately not a "card": no border, no shadow — the supporting
    // sections below are white bordered panels, and the hero needs to
    // read as the page's lead register, not the first item in that stack.
    <div className="rounded-2xl bg-teal-050 p-6 sm:p-10">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Unified Credit Score</h1>

          <div
            className="mt-3 inline-flex items-baseline gap-3 rounded-xl"
            style={{ animation: 'score-assemble 700ms cubic-bezier(0.16,1,0.3,1) 380ms both' }}
          >
            {score !== null ? (
              <span className="font-mono text-5xl font-bold tabular-nums leading-none tracking-tight text-text-primary">
                {score}
              </span>
            ) : (
              <span className="text-5xl font-bold leading-none text-text-muted">—</span>
            )}
            {tokens && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
                style={{ backgroundColor: tokens.bg, color: tokens.fg }}
              >
                {tokens.label}
              </span>
            )}
          </div>

          <p className="mt-4 text-sm text-text-muted">
            Refreshed {new Date(lastRefreshedAt).toLocaleString('en-ZA')} · {syncedBureaus} of{' '}
            {bureauScores.length} bureaus synced
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 self-start rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors duration-normal hover:border-teal-700 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh from bureaus'}
        </button>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-teal-200/70 pt-6">
        {bureauScores.map((entry, i) => {
          const hasScore = entry.score !== null;
          // Band comes from the API, computed on the bureau's normalised scale.
          const entryBand = entry.scoreBand;
          const entryTokens = entryBand ? scoreBandTokens[entryBand] : null;
          return (
            <div
              key={entry.bureau}
              className="opacity-0"
              style={{
                animation: `bureau-settle 450ms cubic-bezier(0.16,1,0.3,1) ${i * 90}ms both`,
              }}
            >
              <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium uppercase tracking-wide text-text-muted">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: hasScore ? (entryTokens?.icon ?? '#0D9488') : '#CBD5E1',
                  }}
                />
                <span className="sm:hidden">{BUREAU_INITIALS[entry.bureau]}</span>
                <span className="hidden sm:inline">{BUREAU_LABELS[entry.bureau]}</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-text-primary">
                {hasScore ? entry.score : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
