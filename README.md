# CrediSync

South Africa's real-time, multi-bureau credit orchestration platform: one view of a consumer's
TransUnion, Experian and XDS records, guided disputes, and a bank-readiness score — built for POPIA
and the National Credit Act.

> **Status: pre-launch.** No real bureau or bank connections exist yet. Local development runs on
> clearly labelled **sandbox** (synthetic) data. See [Open items before go-live](#open-items-before-go-live).

## Architecture

```
 web (Next.js) ─┐                    ┌─ auth              users, sessions, consent, POPIA export/erasure
 admin (Next.js)├─► api-gateway ─────┼─ bureau-ingestion  bureau pulls, entity resolution, unified score
 mobile (Flutter)┘  (only public     ├─ dispute-engine    letters, lifecycle, deadlines, signed webhooks
                     entry point)    ├─ open-banking      Stitch/Ozow links, affordability snapshots
                                     └─ bank-readiness    Python rules scorer
                          all ─────► PostgreSQL (row-level security enforced)
 jobs (scheduled): deadlines, erasure, retention, partitions
```

| Path                  | What it is                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `db/schema.sql`       | Canonical schema (identical to the initial migration; a test enforces it) |
| `packages/db`         | Pool + `withUser` / `withSystem` request context for row-level security   |
| `packages/crypto`     | AES-256-GCM envelope encryption (AWS KMS in production), keyed HMAC       |
| `packages/middleware` | JWT, service tokens, rate limiting, trace ids, security headers           |
| `packages/types`      | Shared enums (tested against `db/schema.sql`) and SA ID validation        |
| `packages/jobs`       | Scheduled jobs                                                            |
| `packages/migrations` | Migration runner (advisory-locked, owner connection)                      |
| `e2e/`                | Every service in-process behind the gateway, against a throwaway database |
| `design-system/`      | Design tokens shared by web, admin and the Flutter theme                  |

## Running locally

Requirements: Node 20+, Docker. Optional: Python 3.12 (scorer), Flutter (mobile).

```bash
npm ci
docker compose up --build        # API on http://localhost:4000/api (sandbox data)
npm run dev -w web               # consumer app on http://localhost:3000
npm run dev -w admin             # staff portal on http://localhost:3001
docker compose run --rm jobs all # run scheduled jobs once
```

Sign up in the web app; the verification link is printed in the `auth` container logs (development
only). To make a staff user, set `role = 'admin'` on their row as the database owner.

Mobile: `cd mobile && flutter run` (an Android emulator reaches the API at `10.0.2.2:4000`).
Release builds require `--dart-define=API_BASE_URL=https://...`.

## Tests

```bash
npm run typecheck && npm run lint && npm run format:check
docker run -d --name cs-pg -e POSTGRES_USER=credisync -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:15-alpine
TEST_DATABASE_ADMIN_URL=postgres://credisync:pw@localhost:55432/credisync npm test
```

Integration and end-to-end suites create a throwaway database per run and **skip** when
`TEST_DATABASE_ADMIN_URL` is unset. CI always sets it. Python: `cd ai/bank-readiness && pytest`.
Flutter: `cd mobile && flutter test`.

## Security model

- **One public entry point.** Internal services require the gateway's `X-Internal-Token` and take the
  acting user only from gateway-set headers — never from a URL or request body. In production also
  keep them on private subnets.
- **Row-level security is enforced**, not decorative: services connect as the non-owner role
  `credisync_app`, every personal-information table has `FORCE ROW LEVEL SECURITY`, and each request
  declares either one consumer (`withUser`) or explicit, audited system context (`withSystem`).
- **Sessions:** 15-minute access tokens (HS256, pinned issuer/audience, role claim) and rotating
  refresh tokens with replay detection. Browsers get httpOnly `SameSite=Strict` cookies plus an
  Origin check; mobile keeps tokens in the platform keystore.
- **SA ID numbers** are validated (Luhn), encrypted with envelope encryption (KMS in `af-south-1`),
  looked up by keyed HMAC, decrypted only inside bureau-ingestion just before a pull, and shown
  masked everywhere else.
- **Secrets** have development fallbacks only when `NODE_ENV` is `development` or `test`; any other
  environment refuses to start without them.
- **Bureau webhooks** are HMAC-signed per bureau, time-bounded and idempotent.

## Compliance features

- POPIA consent is required, versioned (`POPIA_POLICY_VERSION`) and recorded per change; users can
  grant or withdraw credit-check, open-banking, marketing and sharing permissions.
- POPIA s23 data export and s24 erasure (7-day grace period; files, then the user, are deleted; a
  pseudonymous audit record remains).
- Append-only audit log (5-year floor; only the retention job can purge older rows). Staff views and
  actions are audited with the staff member's id.
- Bureau pulls require a verified email and credit-check consent, with a cooldown.
- Disputes: 20-business-day deadlines on the SA calendar (including declared one-off holidays), a
  monitor that flags and notifies missed deadlines, and escalation only after rejection or a missed
  deadline.
- Affordability: unclassified money in is not counted as income; NCA minimum expense norms applied.

## Open items before go-live

The code side is complete; what remains needs a person, a contract or an AWS account. The full list,
with owners to fill in, is [docs/go-live-checklist.md](docs/go-live-checklist.md). Supporting packs:

- [Legal review pack](docs/legal-review-pack.md) — dispute letter, consent wording and retention, with
  numbered questions for counsel. Production refuses to generate letters until sign-off is recorded.
- [Bureau and provider integration checklist](docs/bureau-integration-checklist.md) — what to get from
  each bureau and Stitch, and exactly where each item goes in the code.
- [Regulatory figures](docs/regulatory-figures.md) — NCA expense norms, response period, retention
  periods and score bands, each configurable, with a sign-off table.
- [Infrastructure runbook](infra/terraform/README.md) — Terraform for ECS Fargate in af-south-1,
  bootstrap and deploy steps.

Built and ready: transactional outbox to SNS, SES email (af-south-1), PDF letters (consumer and
audited lodging copies), Redis rate limiting, the Stitch consent flow (OAuth 2.0 + PKCE) with token
refresh, and Terraform with CI validation and security scanning. Deliberately not built: SMS (email
only for now) and a bureau dispute API channel (manual lodging until bureaus offer one).
