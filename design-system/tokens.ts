/**
 * CrediSync Design Tokens — "Home Ground"
 *
 * Single source of truth for the visual identity.
 * Consumed by the Tailwind config (web, admin) and referenced by the Flutter theme (mobile).
 *
 * Principles:
 *  - Light, high-contrast ground with one confident teal accent — the
 *    grammar of the banking apps this audience already trusts daily
 *    (Capitec, Discovery, FNB), not an imported navy-glass SaaS template
 *  - High-contrast text pairs (WCAG AA minimum)
 *  - Semantic status colours mapped 1-to-1 to credit-bureau score bands
 *    and database status enum values
 *  - `navy*` primitives are retained only for surfaces mid-migration
 *    (see admin/) — new work reaches for `teal`/`ink`, not `navy`
 */

// ---------------------------------------------------------------------------
// Primitive palette (raw HEX values)
// ---------------------------------------------------------------------------
export const primitives = {
  // Brand blues / slates — legacy scale, kept for surfaces mid-migration.
  // Do not reach for these in new "Home Ground" work; use `teal` / `ink`.
  navy950:  '#040D1A',
  navy900:  '#071428',
  navy800:  '#0D2247',
  navy700:  '#0F3460',
  navy600:  '#1A4F8A',
  navy500:  '#2563EB',
  navy400:  '#3B82F6',
  navy300:  '#93C5FD',
  navy200:  '#BFDBFE',
  navy100:  '#DBEAFE',
  navy050:  '#EFF6FF',

  // Ink — near-black text/ground primitive for the light "Home Ground" world
  ink900:   '#0B0F14',
  ink800:   '#12181F',
  ink700:   '#1C242D',

  // Neutrals
  slate900: '#0F172A',
  slate800: '#1E293B',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748B',
  slate400: '#94A3B8',
  slate300: '#CBD5E1',
  slate200: '#E2E8F0',
  slate100: '#F1F5F9',
  slate050: '#F8FAFC',
  white:    '#FFFFFF',

  // Semantic status (score bands)
  green700: '#15803D',
  green600: '#16A34A',
  green500: '#22C55E',
  green100: '#DCFCE7',

  amber700: '#B45309',
  amber600: '#D97706',
  amber500: '#F59E0B',
  amber100: '#FEF3C7',

  red700:   '#B91C1C',
  red600:   '#DC2626',
  red500:   '#EF4444',
  red100:   '#FEE2E2',

  // Accent — the "Home Ground" brand teal. Deliberately not blue (the
  // incumbent default) and not green/amber/red (reserved for score-band
  // and account-status semantics below).
  teal900:  '#04302C',
  teal800:  '#075C53',
  teal700:  '#0B7A70',
  teal600:  '#0D9488',
  teal500:  '#14B8A6',
  teal200:  '#8FE0D3',
  teal100:  '#CCFBF1',
  teal050:  '#EFFCF9',
} as const;

// ---------------------------------------------------------------------------
// Semantic tokens (purpose-driven aliases)
// ---------------------------------------------------------------------------
export const semantic = {
  // Backgrounds — a soft ivory ground with white surfaces stacked above
  // it, the register South Africa's own daily banking apps use, checked
  // in bright outdoor light as often as indoors.
  bgBase:        '#F5F7F8',
  bgSurface:     primitives.white,
  bgCard:        primitives.white,
  bgMuted:       '#EEF1F3',
  bgSubtle:      primitives.slate100,

  // Text
  textPrimary:   primitives.ink800,
  textSecondary: '#3F4A57',
  textMuted:     '#6B7684',
  textInverse:   primitives.white,
  textLink:      primitives.teal700,
  textLinkHover: primitives.teal800,

  // Borders
  borderDefault: '#E2E6EA',
  borderSubtle:  '#EDF0F3',
  borderFocus:   primitives.teal700,

  // Brand
  brandPrimary:  primitives.teal700,
  brandHover:    primitives.teal800,
  brandActive:   primitives.teal900,

  // --- Score band / bureau status tokens ---
  // Maps directly to PostgreSQL enum values (see db/schema.sql)
  //   score_band: 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor'
  //   account_status: 'current' | 'arrears' | 'default' | 'judgement' | 'written_off' | 'unknown'

  statusExcellentBg:   primitives.green100,
  statusExcellentFg:   primitives.green700,
  statusExcellentIcon: primitives.green500,

  statusGoodBg:        primitives.green100,
  statusGoodFg:        primitives.green600,
  statusGoodIcon:      primitives.green500,

  statusFairBg:        primitives.amber100,
  statusFairFg:        primitives.amber700,
  statusFairIcon:      primitives.amber500,

  statusPoorBg:        primitives.amber100,
  statusPoorFg:        primitives.amber600,
  statusPoorIcon:      primitives.amber500,

  statusVeryPoorBg:    primitives.red100,
  statusVeryPoorFg:    primitives.red700,
  statusVeryPoorIcon:  primitives.red500,

  // Account status
  statusCurrentBg:     primitives.green100,
  statusCurrentFg:     primitives.green700,

  statusArrearsBg:     primitives.amber100,
  statusArrearsFg:     primitives.amber700,

  statusDefaultBg:     primitives.red100,
  statusDefaultFg:     primitives.red700,

  statusJudgementBg:   primitives.red100,
  statusJudgementFg:   primitives.red700,

  statusWrittenOffBg:  primitives.slate100,
  statusWrittenOffFg:  primitives.slate600,

  // Bureau sent a status we haven't mapped yet: neutral, outlined, never adverse.
  statusUnknownBg:     primitives.white,
  statusUnknownFg:     primitives.slate600,
  statusUnknownBorder: primitives.slate300,

  // Alerts / toasts
  alertSuccess:  primitives.green600,
  alertWarning:  primitives.amber600,
  alertError:    primitives.red600,
  alertInfo:     primitives.teal600,
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
export const typography = {
  fontFamilySans:  "var(--font-inter), 'Inter', 'DM Sans', ui-sans-serif, system-ui, sans-serif",
  fontFamilyMono:  "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",

  // Scale (rem, base 16 px)
  size5xl:  '4.5rem',   // 72 px – unified score hero numeral
  size4xl:  '2.75rem',  // 44 px – bureau numerals, large stat emphasis
  size3xl:  '1.875rem', // 30 px – section-level emphasis
  size2xl:  '1.5rem',   // 24 px – section headings
  sizeXl:   '1.25rem',  // 20 px – card headings
  sizeLg:   '1.125rem', // 18 px – sub-headings
  sizeMd:   '1rem',     // 16 px – body
  sizeSm:   '0.875rem', // 14 px – secondary body
  sizeXs:   '0.75rem',  // 12 px – labels, badges

  weightLight:    '300',
  weightRegular:  '400',
  weightMedium:   '500',
  weightSemibold: '600',
  weightBold:     '700',

  lineHeightTight:  '1.25',
  lineHeightNormal: '1.5',
  lineHeightRelaxed:'1.625',

  letterSpacingTight: '-0.025em',
  letterSpacingNormal: '0em',
  letterSpacingWide:   '0.025em',
  letterSpacingWidest: '0.1em',   // uppercase labels/badges
} as const;

// ---------------------------------------------------------------------------
// Spacing (4-point grid)
// ---------------------------------------------------------------------------
export const spacing = {
  px:  '1px',
  s0:  '0',
  s1:  '0.25rem',  // 4 px
  s2:  '0.5rem',   // 8 px
  s3:  '0.75rem',  // 12 px
  s4:  '1rem',     // 16 px
  s5:  '1.25rem',  // 20 px
  s6:  '1.5rem',   // 24 px
  s8:  '2rem',     // 32 px
  s10: '2.5rem',   // 40 px
  s12: '3rem',     // 48 px
  s16: '4rem',     // 64 px
  s20: '5rem',     // 80 px
  s24: '6rem',     // 96 px
} as const;

// ---------------------------------------------------------------------------
// Border radii
// ---------------------------------------------------------------------------
export const radii = {
  none:  '0',
  sm:    '0.25rem',  // 4 px
  md:    '0.5rem',   // 8 px
  lg:    '0.75rem',  // 12 px
  xl:    '1rem',     // 16 px
  '2xl': '1.5rem',   // 24 px
  full:  '9999px',
} as const;

// ---------------------------------------------------------------------------
// Shadows — light-ground depth: real offset plus soft blur, never a
// zero-offset colour halo standing in for elevation.
// ---------------------------------------------------------------------------
export const shadows = {
  sm:   '0 1px 2px 0 rgba(15,23,32,0.06)',
  md:   '0 4px 10px -2px rgba(15,23,32,0.10), 0 2px 4px -2px rgba(15,23,32,0.06)',
  lg:   '0 16px 32px -8px rgba(15,23,32,0.16), 0 4px 8px -4px rgba(15,23,32,0.08)',
  glow: '0 0 0 4px rgba(11,122,112,0.16)',   // teal focus/active halo — ring, not elevation
} as const;

// ---------------------------------------------------------------------------
// Breakpoints (mobile-first, SA landscape)
// ---------------------------------------------------------------------------
export const breakpoints = {
  xs:  '360px',   // entry-level Android
  sm:  '640px',
  md:  '768px',
  lg:  '1024px',
  xl:  '1280px',
  '2xl': '1536px',
} as const;

// ---------------------------------------------------------------------------
// Z-index scale
// ---------------------------------------------------------------------------
export const zIndex = {
  base:    0,
  raised:  10,
  dropdown:20,
  sticky:  30,
  overlay: 40,
  modal:   50,
  toast:   60,
} as const;

// ---------------------------------------------------------------------------
// Transition / animation
// ---------------------------------------------------------------------------
export const motion = {
  durationFast:   '150ms',
  durationNormal: '200ms',
  durationSlow:   '350ms',
  durationUnfold: '700ms', // the signature bureau→unified score assembly
  easingDefault:  'cubic-bezier(0.4, 0, 0.2, 1)',
  easingIn:       'cubic-bezier(0.4, 0, 1, 1)',
  easingOut:      'cubic-bezier(0, 0, 0.2, 1)',
  easingUnfold:   'cubic-bezier(0.16, 1, 0.3, 1)', // exponential ease-out
} as const;

// ---------------------------------------------------------------------------
// Score band helper (used by both frontend and Node.js services)
// ---------------------------------------------------------------------------
export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';

export function getScoreBand(score: number): ScoreBand {
  if (score >= 767) return 'excellent';
  if (score >= 681) return 'good';
  if (score >= 614) return 'fair';
  if (score >= 583) return 'poor';
  return 'very_poor';
}

export interface ScoreBandToken {
  bg:   string;
  fg:   string;
  icon: string;
  label: string;
}

export const scoreBandTokens: Record<ScoreBand, ScoreBandToken> = {
  excellent: {
    bg:    semantic.statusExcellentBg,
    fg:    semantic.statusExcellentFg,
    icon:  semantic.statusExcellentIcon,
    label: 'Excellent',
  },
  good: {
    bg:    semantic.statusGoodBg,
    fg:    semantic.statusGoodFg,
    icon:  semantic.statusGoodIcon,
    label: 'Good',
  },
  fair: {
    bg:    semantic.statusFairBg,
    fg:    semantic.statusFairFg,
    icon:  semantic.statusFairIcon,
    label: 'Fair',
  },
  poor: {
    bg:    semantic.statusPoorBg,
    fg:    semantic.statusPoorFg,
    icon:  semantic.statusPoorIcon,
    label: 'Poor',
  },
  very_poor: {
    bg:    semantic.statusVeryPoorBg,
    fg:    semantic.statusVeryPoorFg,
    icon:  semantic.statusVeryPoorIcon,
    label: 'Very Poor',
  },
};

export type AccountStatus = 'current' | 'arrears' | 'default' | 'judgement' | 'written_off' | 'unknown';

export interface AccountStatusToken {
  bg: string;
  fg: string;
  label: string;
  border?: string;
}

export const accountStatusTokens: Record<AccountStatus, AccountStatusToken> = {
  current:    { bg: semantic.statusCurrentBg,    fg: semantic.statusCurrentFg,    label: 'Current'     },
  arrears:    { bg: semantic.statusArrearsBg,    fg: semantic.statusArrearsFg,    label: 'In Arrears'  },
  default:    { bg: semantic.statusDefaultBg,    fg: semantic.statusDefaultFg,    label: 'Default'     },
  judgement:  { bg: semantic.statusJudgementBg,  fg: semantic.statusJudgementFg,  label: 'Judgement'   },
  written_off:{ bg: semantic.statusWrittenOffBg, fg: semantic.statusWrittenOffFg, label: 'Written Off' },
  unknown:    { bg: semantic.statusUnknownBg,    fg: semantic.statusUnknownFg,    label: 'Status unknown', border: semantic.statusUnknownBorder },
};
