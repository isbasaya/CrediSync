# Bureau and provider integration checklist

**For:** whoever negotiates and onboards TransUnion, Experian, XDS and Stitch, and the engineer who
wires each one in. Each item names exactly where in the code it lands, so a signed contract turns into
a small, reviewable change.

The platform runs end-to-end today on **synthetic sandbox data** (`BUREAU_MODE=sandbox`,
`OPEN_BANKING_MODE=sandbox`), which the services refuse outside development.

---

## Per credit bureau (TransUnion, Experian, XDS)

Ask each bureau for the following, then fill in the matching place in the code.

| #   | Need from the bureau                                                                                                                                      | Where it goes                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Signed data-access agreement naming the permissible purpose (consumer's own report).                                                                      | Legal file; confirms the credit-check consent wording (legal pack C1, C2).                                                           |
| B2  | API base URL, authentication method (OAuth2 client credentials, mTLS cert, HMAC, API key) and sandbox credentials.                                        | `services/bureau-ingestion/src/adapters/<bureau>.adapter.ts` constructor and request headers; secrets in Secrets Manager.            |
| B3  | Consumer-report request and response schema (field names).                                                                                                | The `*Raw*` interfaces and `map*` function in the same adapter. Nothing downstream changes.                                          |
| B4  | Full list of account-status codes and their meanings.                                                                                                     | `services/bureau-ingestion/src/adapters/status-mapping.ts` (`STATUS_TABLE`). Unmapped codes show as "Status unknown" and are logged. |
| B5  | Score product name and **score range** (min, max) plus the bureau's own band cut-offs.                                                                    | `BUREAU_SCORE_RANGES` env, e.g. `{"experian":[0,999]}` (`entity-resolution/score-normalisation.ts`).                                 |
| B6  | Whether a consumer pull is recorded as an enquiry, and rate limits per minute/day.                                                                        | Cooldown `BUREAU_REFRESH_COOLDOWN_MS` (default 1 hour) and the circuit breaker (`circuit-breaker.ts`).                               |
| B7  | Official consumer-dispute channel (portal, email or API) and required fields.                                                                             | `BUREAU_DISPUTE_CONTACTS` env (`dispute-engine/src/templates/legal-references.ts`), set `verified: true`.                            |
| B8  | Whether disputes can be lodged by API, and the response/outcome notification method.                                                                      | Manual lodging works today. An API channel is a new `DISPUTE_SUBMISSION_CHANNEL=bureau_api` implementation.                          |
| B9  | Webhook signing: shared secret, header, timestamp tolerance; or agree ours: `X-CrediSync-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. | Secret in `credisync-<env>/bureau_webhook_secret_<bureau>`; endpoint `POST https://<api_domain>/api/webhooks/bureau-response`.       |
| B10 | Test consumers (synthetic IDs) covering: thin file, judgement, default, written-off, closed account, duplicate across bureaus.                            | Add an adapter contract test with recorded sandbox responses.                                                                        |

**Data handling to confirm with each bureau:** we send the consumer's full ID number, first name and
surname over TLS from af-south-1; we store their report figures (not the raw payload); we never log
the ID number.

---

## Stitch (open banking)

Implemented against Stitch's public docs: OAuth 2.0 authorisation code + PKCE (S256) at
`https://secure.stitch.money/connect/authorize` and `/connect/token`, client-secret authentication,
rotating refresh tokens, GraphQL at `https://api.stitch.money/graphql`.

| #   | Need from Stitch                                                                                                                                                                                                                                                                                                                      | Where it goes                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| S1  | Client id and client secret (test and live).                                                                                                                                                                                                                                                                                          | `stitch_client_id` Terraform var; secret in `credisync-<env>/stitch_client_secret`. |
| S2  | Whitelist the redirect URI `https://<app domain>/bank/callback` (per environment).                                                                                                                                                                                                                                                    | `stitch_redirect_uri` Terraform var.                                                |
| S3  | Confirm scopes `openid offline_access accounts transactions balances` are enabled for the client.                                                                                                                                                                                                                                     | `STITCH_SCOPES` in `services/open-banking/src/providers/stitch-oauth.ts`.           |
| S4  | Confirm the GraphQL fields we query: `user.bankAccounts { id name }`, `node(id) { ... on BankAccount { transactions(first, after) { pageInfo { hasNextPage endCursor } edges { node { id amount { quantity currency } date description reference runningBalance { quantity currency } } } } } }`. Run them in the Stitch sandbox IDE. | `services/open-banking/src/adapters/stitch.adapter.ts`.                             |
| S5  | Token lifetimes (access, refresh) and refresh-token rotation behaviour.                                                                                                                                                                                                                                                               | Refresh happens 60 s before expiry (`TOKEN_REFRESH_SKEW_MS` in `app.ts`).           |
| S6  | Whether client authentication must move to a signed JWT (`client_assertion`) for live clients.                                                                                                                                                                                                                                        | `StitchOAuthClient.token()`.                                                        |

## Ozow

The Ozow adapter is a placeholder; its account-verification payloads were never confirmed. Either
obtain Ozow's API reference and consent flow, or drop Ozow and rely on Stitch.
