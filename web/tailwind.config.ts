import type { Config } from 'tailwindcss';
import { primitives, semantic, typography, spacing, radii, shadows, breakpoints } from '../design-system/tokens';

/**
 * CrediSync Tailwind CSS Configuration
 *
 * Extends the Tailwind default theme with CrediSync design tokens.
 * All custom values are derived from `design-system/tokens.ts` to guarantee
 * a single source of truth across the web portal and design system.
 *
 * Purge paths are intentionally broad to cover the React web-portal structure.
 */
const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    // -------------------------------------------------------------------------
    // Screens (mobile-first, SA market)
    // -------------------------------------------------------------------------
    screens: {
      xs:   breakpoints.xs,
      sm:   breakpoints.sm,
      md:   breakpoints.md,
      lg:   breakpoints.lg,
      xl:   breakpoints.xl,
      '2xl': breakpoints['2xl'],
    },


    // -------------------------------------------------------------------------
    // Border radius
    // -------------------------------------------------------------------------
    borderRadius: {
      none:  radii.none,
      sm:    radii.sm,
      DEFAULT: radii.md,
      md:    radii.md,
      lg:    radii.lg,
      xl:    radii.xl,
      '2xl': radii['2xl'],
      full:  radii.full,
    },

    // -------------------------------------------------------------------------
    // Typography
    // -------------------------------------------------------------------------
    fontFamily: {
      sans: [typography.fontFamilySans],
      mono: [typography.fontFamilyMono],
    },
    fontSize: {
      xs:   [typography.sizeXs,  { lineHeight: typography.lineHeightNormal }],
      sm:   [typography.sizeSm,  { lineHeight: typography.lineHeightNormal }],
      base: [typography.sizeMd,  { lineHeight: typography.lineHeightNormal }],
      lg:   [typography.sizeLg,  { lineHeight: typography.lineHeightTight  }],
      xl:   [typography.sizeXl,  { lineHeight: typography.lineHeightTight  }],
      '2xl':[typography.size2xl, { lineHeight: typography.lineHeightTight  }],
      '3xl':[typography.size3xl, { lineHeight: typography.lineHeightTight  }],
      '4xl':[typography.size4xl, { lineHeight: typography.lineHeightTight, letterSpacing: typography.letterSpacingTight }],
      '5xl':[typography.size5xl, { lineHeight: typography.lineHeightTight, letterSpacing: typography.letterSpacingTight }],
    },
    fontWeight: {
      light:    typography.weightLight,
      normal:   typography.weightRegular,
      medium:   typography.weightMedium,
      semibold: typography.weightSemibold,
      bold:     typography.weightBold,
    },
    lineHeight: {
      tight:   typography.lineHeightTight,
      normal:  typography.lineHeightNormal,
      relaxed: typography.lineHeightRelaxed,
    },
    letterSpacing: {
      tight:   typography.letterSpacingTight,
      normal:  typography.letterSpacingNormal,
      wide:    typography.letterSpacingWide,
      widest:  typography.letterSpacingWidest,
    },

    // -------------------------------------------------------------------------
    // Colors
    // -------------------------------------------------------------------------
    colors: {
      transparent: 'transparent',
      current:     'currentColor',
      white:       primitives.white,

      // Primitive scale (useful for one-off overrides)
      navy: {
        950: primitives.navy950,
        900: primitives.navy900,
        800: primitives.navy800,
        700: primitives.navy700,
        600: primitives.navy600,
        500: primitives.navy500,
        400: primitives.navy400,
        300: primitives.navy300,
        200: primitives.navy200,
        100: primitives.navy100,
        '050': primitives.navy050,
      },
      slate: {
        900: primitives.slate900,
        800: primitives.slate800,
        700: primitives.slate700,
        600: primitives.slate600,
        500: primitives.slate500,
        400: primitives.slate400,
        300: primitives.slate300,
        200: primitives.slate200,
        100: primitives.slate100,
        '050': primitives.slate050,
      },
      green: {
        700: primitives.green700,
        600: primitives.green600,
        500: primitives.green500,
        100: primitives.green100,
      },
      amber: {
        700: primitives.amber700,
        600: primitives.amber600,
        500: primitives.amber500,
        100: primitives.amber100,
      },
      red: {
        700: primitives.red700,
        600: primitives.red600,
        500: primitives.red500,
        100: primitives.red100,
      },
      teal: {
        900: primitives.teal900,
        800: primitives.teal800,
        700: primitives.teal700,
        600: primitives.teal600,
        500: primitives.teal500,
        200: primitives.teal200,
        100: primitives.teal100,
        '050': primitives.teal050,
      },
      ink: {
        900: primitives.ink900,
        800: primitives.ink800,
        700: primitives.ink700,
      },

      // Semantic aliases exposed as Tailwind utilities
      // e.g. bg-bg-base, text-text-primary, border-border-default
      'bg-base':        semantic.bgBase,
      'bg-surface':     semantic.bgSurface,
      'bg-card':        semantic.bgCard,
      'bg-muted':       semantic.bgMuted,
      'bg-subtle':      semantic.bgSubtle,
      'text-primary':   semantic.textPrimary,
      'text-secondary': semantic.textSecondary,
      'text-muted':     semantic.textMuted,
      'text-inverse':   semantic.textInverse,
      'text-link':      semantic.textLink,
      'brand-primary':  semantic.brandPrimary,
      'brand-hover':    semantic.brandHover,
      'border-default': semantic.borderDefault,
      'border-subtle':  semantic.borderSubtle,
      'border-focus':   semantic.borderFocus,

      // Status / score-band tokens
      'status-excellent-bg':   semantic.statusExcellentBg,
      'status-excellent-fg':   semantic.statusExcellentFg,
      'status-good-bg':        semantic.statusGoodBg,
      'status-good-fg':        semantic.statusGoodFg,
      'status-fair-bg':        semantic.statusFairBg,
      'status-fair-fg':        semantic.statusFairFg,
      'status-poor-bg':        semantic.statusPoorBg,
      'status-poor-fg':        semantic.statusPoorFg,
      'status-very-poor-bg':   semantic.statusVeryPoorBg,
      'status-very-poor-fg':   semantic.statusVeryPoorFg,
      'status-current-bg':     semantic.statusCurrentBg,
      'status-current-fg':     semantic.statusCurrentFg,
      'status-arrears-bg':     semantic.statusArrearsBg,
      'status-arrears-fg':     semantic.statusArrearsFg,
      'status-default-bg':     semantic.statusDefaultBg,
      'status-default-fg':     semantic.statusDefaultFg,
      'status-judgement-bg':   semantic.statusJudgementBg,
      'status-judgement-fg':   semantic.statusJudgementFg,
      'status-written-off-bg': semantic.statusWrittenOffBg,
      'status-written-off-fg': semantic.statusWrittenOffFg,
      'status-unknown-bg': semantic.statusUnknownBg,
      'status-unknown-fg': semantic.statusUnknownFg,
      'status-unknown-border': semantic.statusUnknownBorder,

      // Alert
      'alert-success':  semantic.alertSuccess,
      'alert-warning':  semantic.alertWarning,
      'alert-error':    semantic.alertError,
      'alert-info':     semantic.alertInfo,
    },

    // -------------------------------------------------------------------------
    // Shadows
    // -------------------------------------------------------------------------
    boxShadow: {
      sm:   shadows.sm,
      DEFAULT: shadows.md,
      md:   shadows.md,
      lg:   shadows.lg,
      glow: shadows.glow,
      none: 'none',
    },

    extend: {
      // Named 4-point-grid aliases layered on top of Tailwind's full
      // default spacing scale (not a replacement — replacing `spacing`
      // wholesale drops the half-steps like 0.5/1.5/2.5 that badges and
      // icon-gap utilities rely on). Values match Tailwind's defaults
      // exactly, so this only adds the named tokens, it changes nothing.
      spacing: {
        px:   spacing.px,
        '0':  spacing.s0,
        '1':  spacing.s1,
        '2':  spacing.s2,
        '3':  spacing.s3,
        '4':  spacing.s4,
        '5':  spacing.s5,
        '6':  spacing.s6,
        '8':  spacing.s8,
        '10': spacing.s10,
        '12': spacing.s12,
        '16': spacing.s16,
        '20': spacing.s20,
        '24': spacing.s24,
      },

      // Smooth transitions
      transitionDuration: {
        fast:   '150ms',
        normal: '200ms',
        slow:   '350ms',
        unfold: '700ms',
      },
      transitionTimingFunction: {
        default: 'cubic-bezier(0.4, 0, 0.2, 1)',
        in:      'cubic-bezier(0.4, 0, 1, 1)',
        out:     'cubic-bezier(0, 0, 0.2, 1)',
        unfold:  'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      // NOTE: the signature "bureau settle / score assemble" interaction
      // needs a per-item computed delay (i * 90ms), so it's driven by an
      // inline `style` in ScoreHero.tsx rather than these utility classes
      // — Tailwind's JIT purge can't see a dynamic class name to keep a
      // keyframe alive. Those two keyframes are declared directly in
      // globals.css instead, where they're never purged. `fade-in` stays
      // here because every usage is a static `animate-fade-in` class.
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0,0,0.2,1) forwards',
      },
    },
  },
  plugins: [],
};

export default config;
