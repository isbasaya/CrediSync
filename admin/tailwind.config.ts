import type { Config } from 'tailwindcss';
import { primitives, semantic, typography, radii, shadows, breakpoints } from '../design-system/tokens';

/**
 * CrediSync Admin Tailwind Configuration
 *
 * Extends (not replaces) Tailwind's default palette with the shared
 * design tokens from `design-system/tokens.ts` — the same source the
 * consumer web portal uses — so both surfaces stay visually consistent.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      xs: breakpoints.xs,
      sm: breakpoints.sm,
      md: breakpoints.md,
      lg: breakpoints.lg,
      xl: breakpoints.xl,
      '2xl': breakpoints['2xl'],
    },
    extend: {
      fontFamily: {
        sans: [typography.fontFamilySans],
        mono: [typography.fontFamilyMono],
      },
      colors: {
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
        ink: {
          900: primitives.ink900,
          800: primitives.ink800,
          700: primitives.ink700,
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

        // Semantic aliases shared with the web portal
        'bg-base':        semantic.bgBase,
        'bg-surface':      semantic.bgSurface,
        'bg-card':         semantic.bgCard,
        'bg-muted':        semantic.bgMuted,
        'text-primary':    semantic.textPrimary,
        'text-secondary':  semantic.textSecondary,
        'text-muted':      semantic.textMuted,
        'brand-primary':   semantic.brandPrimary,
        'brand-hover':     semantic.brandHover,
        'border-default':  semantic.borderDefault,
        'border-subtle':   semantic.borderSubtle,
        'border-focus':    semantic.borderFocus,

        'status-excellent-bg': semantic.statusExcellentBg,
        'status-excellent-fg': semantic.statusExcellentFg,
        'status-good-bg':       semantic.statusGoodBg,
        'status-good-fg':       semantic.statusGoodFg,
        'status-fair-bg':       semantic.statusFairBg,
        'status-fair-fg':       semantic.statusFairFg,
        'status-poor-bg':       semantic.statusPoorBg,
        'status-poor-fg':       semantic.statusPoorFg,
        'status-very-poor-bg':  semantic.statusVeryPoorBg,
        'status-very-poor-fg':  semantic.statusVeryPoorFg,

        'alert-success': semantic.alertSuccess,
        'alert-warning': semantic.alertWarning,
        'alert-error':   semantic.alertError,
        'alert-info':    semantic.alertInfo,
      },
      borderRadius: {
        xl: radii.xl,
        '2xl': radii['2xl'],
      },
      boxShadow: {
        glow: shadows.glow,
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
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
