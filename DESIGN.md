---
name: CrediSync
description: South Africa's real-time, multi-bureau credit orchestration platform
colors:
  teal-primary: "#0B7A70"
  teal-hover: "#075C53"
  teal-active: "#04302C"
  teal-tint: "#EFFCF9"
  ink: "#12181F"
  ink-secondary: "#3F4A57"
  ink-muted: "#6B7684"
  ground: "#F5F7F8"
  surface: "#FFFFFF"
  surface-muted: "#EEF1F3"
  border: "#E2E6EA"
  border-subtle: "#EDF0F3"
  score-good: "#16A34A"
  score-caution: "#F59E0B"
  score-risk: "#DC2626"
typography:
  display:
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
    fontSize: "4.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "var(--font-inter), 'Inter', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.1em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.teal-primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.teal-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  score-hero:
    backgroundColor: "{colors.teal-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "24px 40px"
---

# Design System: CrediSync — Home Ground

## Overview

**Creative North Star: "Home Ground"**

CrediSync should read like the banking app its audience already trusts every day — Capitec, Discovery, FNB — not an imported navy-glass SaaS dashboard performing trustworthiness through darkness and blue gradients. The system is light, high-contrast, and confident: one accent color (a deep teal, deliberately not blue) carries brand weight, bold rounded numerals replace gauges and rings, and hierarchy is carried by type scale and weight rather than uniform card chrome. This is a redesign: the prior dark navy/glass system was evidence of what the product does, not a constraint on what it looks like, and it has been fully retired for new work (see `## Migration status`).

The system's signature move is the "assemble" interaction on the unified score: the three bureau readings settle into place first, and the unified score assembles a beat behind them — orchestration made visible rather than merely claimed. It is the one piece of authored motion in the system; everything else stays quiet so that moment reads as deliberate.

This is an Operate surface (task completion, not persuasion): expression never outranks scanability, the real usage scene (South African consumers, often on entry-level Android hardware, often outdoors in bright daylight, checking a credit score that carries real financial stress) sets the bar, and severity is always legible before the reader has to think about it.

**Key Characteristics:**
- Light ivory ground (`#F5F7F8`) with white surface panels — never dark-mode-by-default
- One confident teal accent, not blue (blue is the retired identity) and not the score-band semantic colors (green/amber/red are reserved for status, never used decoratively)
- Bold tabular-mono numerals for every score, balance, and reference figure
- Severity carries visual weight: the worst problem is set larger, not just colored differently
- No uniform icon+heading+stat card grids; no progress rings or gauges standing in for content

## Colors

A light, high-contrast ground with one confident accent; status colors are semantic and never reused decoratively.

### Primary
- **Home Ground Teal** (`#0B7A70`): the single brand accent. Buttons, links, focus rings, active states, the score-hero wash. Reserved — never used for score-band or account-status semantics.

### Neutral
- **Ivory Ground** (`#F5F7F8`): the page background every surface sits on.
- **Surface White** (`#FFFFFF`): card and panel backgrounds.
- **Surface Muted** (`#EEF1F3`): skeleton loading blocks, hover fills, quiet dividers.
- **Ink** (`#12181F`): primary text, primary numerals.
- **Ink Secondary** (`#3F4A57`): secondary text (balances, supporting copy).
- **Ink Muted** (`#6B7684`): captions, timestamps, muted labels.
- **Border** (`#E2E6EA`): default card/panel borders.

### Status (semantic, not decorative)
- **Score Good** (`#16A34A` / `#15803D` family): excellent/good score bands, current accounts.
- **Score Caution** (`#F59E0B` / `#D97706` family): fair/poor score bands, arrears.
- **Score Risk** (`#DC2626` / `#B91C1C` family): very-poor band, default and judgement accounts.

These map 1-to-1 to `score_band` and `account_status` in `db/schema.sql`; do not repurpose them for brand or navigation.

### Named Rules
**The One Accent Rule.** Teal is the only saturated brand color on the page. Everything that is not brand or status stays neutral ink/ivory/white — no secondary decorative color, no gradient.

**The Reserved Semantics Rule.** Green/amber/red exist only to answer "is this account/score okay?" — never as a brand accent, never on a button, never on a nav item.

## Typography

**Display Font:** JetBrains Mono (fallback: Fira Code, ui-monospace)
**Body Font:** Inter (fallback: DM Sans, system-ui)

**Character:** Inter carries every word on the page — headings, labels, body, copy — deliberately staying a workhorse face, since this is an Operate surface where legibility outranks personality. JetBrains Mono is reserved entirely for numerals: scores, balances, reference figures. The pairing reads as "a serious financial instrument," not "a marketing site."

### Hierarchy
- **Display** (700, 4.5rem/72px, tight): the unified score numeral only. Monospace, tabular.
- **Headline** (600, 1.125rem/18px): card/section titles ("Unified Credit Score", "Accounts").
- **Title** (600–700, 1.5–2.75rem): bureau numerals, severity lead figures (judgements/adverse counts). Monospace, tabular.
- **Body** (400, 1rem/16px): descriptive copy, warning banner text.
- **Label** (500, 0.75rem/12px, 0.1em tracking, uppercase): table headers, bureau chip labels.

### Named Rules
**The Tabular Numerals Rule.** Any figure that represents money, a score, or a count that can change on refresh renders in monospace with `tabular-nums` — digits never reflow or jitter as values update.

**No Kicker Rule.** No small-caps eyebrow label ever sits above a heading. The heading carries its own weight.

## Layout

Single-column content, `max-w-4xl`, centered, `p-4 sm:p-6`. Vertical rhythm is a stack of full-width regions with `gap-6` between them — no side-by-side dashboard panels at any breakpoint; South African usage skews mobile, so the desktop layout is the same reading order as mobile, just with more breathing room.

Stat grids run `grid-cols-2` on mobile, `sm:grid-cols-3` at `sm` (640px) and above — always stacked label-above-value inside each cell; a label-and-value-in-one-row pattern is banned below `sm` because it wraps and breaks on narrow (360–390px, entry-level Android) screens.

Breakpoints (from `design-system/tokens.ts`): `xs` 360px, `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. `xs` exists specifically for entry-level Android and should be checked, not assumed compatible by inheritance from `sm`.

## Elevation & Depth

Mostly flat. The score hero is a flat tinted wash (no border, no shadow) — it is deliberately not styled as a "card" so it reads as the page's lead register rather than the first item in a stack of equals. Every supporting section below it (Score by bureau, stats, accounts) is a white panel with a 1px border and a soft, real offset+blur shadow — never a zero-offset color halo.

### Shadow Vocabulary
- **sm** (`0 1px 2px 0 rgba(15,23,32,0.06)`): default card rest state.
- **md** (`0 4px 10px -2px rgba(15,23,32,0.10), 0 2px 4px -2px rgba(15,23,32,0.06)`): reserved for elements that should feel raised above cards (currently unused by any shipped component; available for modals/popovers).
- **glow** (`0 0 0 4px rgba(11,122,112,0.16)`): focus rings and the teal active-state halo — a ring, never elevation.

### Named Rules
**The Hero-Is-Not-A-Card Rule.** Exactly one region per page may use the flat tinted-wash treatment (no border, no shadow): the primary hero. Every other content region is a bordered white panel. Two flat-wash regions on one page collapse the hierarchy the rule exists to create.

## Shapes

Generous rounding throughout: `rounded-2xl` (24px) for section panels and the hero wash alike, `rounded-lg` (12px) for buttons and inputs, `rounded-full` for badges and status pills. No sharp corners anywhere in the system — softness is part of the "trusted daily-use app" register, not "institutional/bureaucratic."

## Components

### Buttons
- **Shape:** `rounded-lg` (12px), never sharper.
- **Primary:** teal background (`#0B7A70`), white text, `px-4 py-2`, semibold. Used for the single most important action on an error/empty state (e.g. "Try again").
- **Secondary:** white background, `border` (1px, `#E2E6EA`), ink text; hover shifts border and text to teal. Used for lower-stakes actions ("Refresh from bureaus").
- **Text link (Dispute):** no background or border, teal text (`#0B7A70`), semibold, paired with a matching stroke icon (gavel). Used inline in dense rows (account table) where a full button would be too heavy.
- **Hover / Focus:** color/border transition at 200ms; focus-visible gets the teal glow ring, `2px` offset.

### Badges (score band / account status)
- **Style:** `rounded-full` pill, tinted background + matching dark-tint text (e.g. green-100 bg / green-700 text). Never outline-only.
- **State:** static — these represent data, not interactive state.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (24px).
- **Background:** white (`#FFFFFF`).
- **Shadow Strategy:** `sm` at rest (see Elevation & Depth). The hero is the one exception — see The Hero-Is-Not-A-Card Rule.
- **Border:** 1px, `#E2E6EA`.
- **Internal Padding:** `p-6`, `sm:p-8` for the hero.

### Tables (accounts)
- **Header:** uppercase label type, muted ink, bottom border only.
- **Rows:** divided by 1px subtle borders, not zebra striping; hover fills with `surface-muted`.
- **Severity:** a judgement/default row's creditor name renders one step larger and semibold — severity is legible from type weight alone, not just the status badge.

### Score Hero (signature component)
A flat teal-tinted region (see Elevation & Depth), containing: the unified score as a 72px tabular-mono numeral beside its band badge, a sync-provenance caption, a secondary "Refresh from bureaus" button, and a row of three per-bureau readings beneath a hairline divider. On load, the bureau readings fade/settle in first (staggered 90ms apart), then the unified numeral assembles 380ms later — the system's one authored motion moment. Respects `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** keep teal as the only saturated brand color; every other surface stays neutral ink/ivory/white.
- **Do** render every score, balance, and count in tabular monospace so digits never jitter.
- **Do** let severity change type size and weight, not just badge color — the worst problem should be legible before the reader reads a single word.
- **Do** keep the hero flat and card-free; card chrome is reserved for supporting sections.
- **Do** check `xs` (360px) explicitly for any new stat grid or multi-column row; South African usage includes entry-level Android hardware.

### Don't:
- **Don't** reintroduce dark navy/glass surfaces, glowing progress rings, or blue as a brand color — that is the retired identity, kept only where `admin/` and `mobile/` haven't been migrated yet.
- **Don't** reuse green/amber/red (score-band and account-status semantics) as decoration, navigation, or brand color.
- **Don't** build a uniform grid of same-size icon+heading+stat cards — this system carries hierarchy through type, not container repetition.
- **Don't** add a kicker or eyebrow label above any heading.
- **Don't** ship a second flat-wash "hero-style" region on the same page as the primary hero.

## Migration status

Implemented and verified in all three surfaces as of this writing: `web/` (consumer dashboard), `admin/` (operations portal), and `mobile/` (native Flutter app — login, signup, dashboard, credit profile, disputes, new-dispute). `web/` and `admin/` were verified in a real browser (desktop + mobile viewports, focus/error states, production builds). `mobile/` was verified on a real Android emulator (Pixel, API level per `shuttlevideo_pixel` AVD): the project had no `android/`/`ios/` platform scaffold at all before this pass (`flutter create --platforms=android,ios .` added it without touching `lib/` or `pubspec.yaml`), a debug APK was built, installed, and launched, and all five screens were exercised live and screenshotted (`.impeccable/review/mobile-*.png`) — login, dashboard, credit profile, disputes list, and new-dispute all render correctly in the Home Ground world with no crashes. `flutter analyze` is clean apart from two non-blocking deprecation infos (`DropdownButtonFormField`'s `value` → `initialValue`, left as-is since the field is still functional and the rename carries an unverified behavior risk not worth taking here).

Admin reuses the same design tokens as web but keeps its own shared primitive library (`admin/src/components/ui.tsx`: `Card`, `StatCard`, `Badge`, `Table`, `Pagination`, `EmptyState`, `PageHeader`) rather than web's per-page components — redesign that file and its consumers inherit the change automatically. Mobile has no equivalent shared-component file; `mobile/lib/theme/app_theme.dart` carries `ScoreBandTheme`, `AccountStatusTheme`, and `DisputeStatusTheme` as the closest analog, but individual screens still hardcode hex literals inline (a pre-existing pattern this redesign preserved rather than refactored, to keep the unverified diff as small and low-risk as possible) — worth revisiting once the surface can be verified again.
