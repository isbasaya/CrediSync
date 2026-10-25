# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Two of the three shipped surfaces are web (Next.js): the consumer dashboard (`web/`) and the internal admin portal (`admin/`). A third surface, `mobile/`, is a native Flutter app (Android/iOS) currently themed as plain Material with no platform-adaptive (Cupertino) treatment. Treat `mobile/` as its own platform context when redesign work reaches it.

## Users

Two distinct audiences:

- **Consumers (web + mobile)** — South African individuals self-serving their own credit health: checking a unified score, reviewing bureau accounts, filing disputes on incorrect records, and tracking progress toward being "bank ready" for a loan or credit application. Likely mobile-first, including entry-level Android hardware and variable connectivity (the existing tokens define a 360px breakpoint for this).
- **CrediSync internal staff (admin)** — operations/compliance personnel who review and manage disputes, moderate user accounts, and work an auditable activity log, under POPIA and National Credit Act obligations.

## Product Purpose

Give South African consumers one real-time, trustworthy view of their credit standing across the country's three bureaus, make clear what is holding their score back, and let them act on it — filing a dispute on an incorrect adverse record, or tracking a bank-readiness score toward qualifying for credit. Admin exists to keep that consumer promise honest: reviewing disputes, managing accounts, and maintaining a compliant, auditable trail.

## Positioning

"South Africa's first real-time, multi-bureau credit orchestration platform." The mechanism a competitor can't copy-paste: TransUnion, Experian, and XDS unified into one live score and account view (most alternatives show a single bureau or a stale batch pull), paired with guided in-app dispute filing instead of paper or call-center processes, and layered with a bank-readiness score/tier (prime / near-prime / sub-prime / unqualified) plus open-banking affordability signals that turn a raw score into an answer to the question consumers actually have: "am I loan-ready?"

## Operating Context

- Regulated under **POPIA** (data minimisation, consent tracking, purpose limitation, access logs) and the **National Credit Act** (dispute record retention, dispute workflow requirements); SA ID numbers are encrypted at rest (application-layer AES-256-GCM envelope encryption, AWS KMS in af-south-1) and row-level security is enforced on every personal-information table.
- Three live bureau integrations: TransUnion, Experian, XDS. Scores roll up to a five-band scale — excellent (767+) / good (681+) / fair (614+) / poor (583+) / very_poor — shared verbatim across web, admin, and mobile.
- Dispute lifecycle: `draft → submitted → under_review → resolved_upheld | resolved_rejected → escalated_ncr` (escalation via the Credit Ombud / National Credit Regulator, allowed after a rejection or a missed 20-business-day deadline).
- Open-banking transaction categorisation (income, housing, transport, debt repayment, etc.) feeds affordability and bank-readiness scoring.
- Backing services: `api-gateway`, `auth`, `bureau-ingestion`, `dispute-engine`, `open-banking`, plus an `ai/bank-readiness` scoring service.
- Only an authenticated dashboard exists on web today — no public marketing/landing site is built or confirmed planned.

## Capabilities and Constraints

- Confirmed: unified credit score with per-bureau comparison, bureau account list with balance/status, dispute creation and tracking, bank-readiness score and tier, admin dispute/user management, admin audit log.
- Constraint: **pre-launch / MVP stage** — no live bureau connections or real user data exist yet (see Evidence on Hand).
- Constraint: all three surfaces currently share one design-token source (`design-system/tokens.ts`), hand-mirrored into the web Tailwind config and the Flutter theme. Any visual redesign must either preserve this single-source-of-truth pattern across all three surfaces or deliberately and explicitly supersede it.
- Undecided: whether a public marketing/landing site is planned. Out of scope unless raised.

## Brand Commitments

- Name: **CrediSync** — confirmed, do not rename.
- Tagline: "South Africa's First Real-Time, Multi-Bureau Credit Orchestration Platform" (README, `mobile/pubspec.yaml`).
- No logo/wordmark asset exists beyond a placeholder `LogoMark` icon component in each app — free to (re)design.
- The current dark navy/slate visual system is evidence of what the product is, not a locked identity: the user has asked for a **redesign**, so the existing look is a starting point and anti-reference, not a constraint to preserve.

## Evidence on Hand

- No real user data, live bureau feeds, or production content exists — the product is pre-launch. Every demonstration score, account, dispute, and user shown in redesigned surfaces must be authored at production fidelity and clearly labeled synthetic.
- Absences future work must not fabricate: customer testimonials, press mentions, competitor benchmarks, or claims of a formal relationship with the NCR beyond the dispute-escalation workflow already in the schema.

## Product Principles

1. **One honest number, with provenance.** The unified score and its bureau breakdown always show which bureaus synced and when — never an opaque single figure.
2. **Show the way out.** Every adverse item or low score pairs with a next action (dispute, readiness guidance) — diagnosis without a path is unfinished.
3. **Trust is the product.** POPIA/NCA-grade rigor, clarity, and restraint outrank flash, on every surface, admin included.
4. **Works on the phone people actually have.** Legibility and performance on entry-level Android hardware and slow connections is a first-class constraint, not a breakpoint afterthought.
5. **One system, three surfaces.** Consumer web, consumer mobile, and internal admin should read as the same institution, even where their tasks differ.

## Accessibility & Inclusion

WCAG AA contrast is an existing stated goal of the current token system and should carry forward. Additional-language support beyond English is not confirmed — treat English as the confirmed default and do not assume further localisation without confirmation.
