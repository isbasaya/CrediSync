# Legal review pack — CrediSync dispute letters, consent and retention

**For:** South African counsel (credit law and POPIA).
**Purpose:** confirm or correct every statutory reference and consumer-facing legal statement before
launch. The product refuses to generate dispute letters in production until this review is recorded
(see [Recording sign-off](#recording-sign-off)).

CrediSync is a consumer app that shows a person their credit records from TransUnion, Experian and
XDS, helps them dispute records they believe are wrong, and estimates how ready they are for bank
credit using bureau and (with consent) bank-transaction data. It is not a credit provider or a credit
bureau.

---

## 1. Dispute letter

Generated per dispute from a fixed template. The consumer chooses a ground and writes a statement;
everything else is filled from their profile and the bureau's record. Two copies exist:

- **Consumer copy** (shown in the app, downloadable as PDF): ID number masked (last 4 digits).
- **Lodging copy** (operations staff only, for submission to the bureau): full ID number, marked
  confidential; every download is logged against the staff member.

Disputes are currently lodged with the bureaus **manually by CrediSync operations staff**, on the
consumer's behalf, until bureau dispute APIs are contracted.

### Current letter text (example)

```
[DRAFT — statutory references pending legal review]

25 October 2026

Experian South Africa (Pty) Ltd — Consumer Disputes

RE: DISPUTE OF CREDIT INFORMATION — SECTION 72 OF THE NATIONAL CREDIT ACT 34 OF 2005 AND THE
REGULATIONS MADE UNDER IT

Consumer details:
  Name: Thandi Nkosi
  ID number: *********9087
  Mobile: +27821234567
  Email: thandi@example.co.za

Disputed account (as reported by the bureau):
  Creditor: Edcon Retail
  Account type: retail
  Account reference: EX-RT-1
  Reported balance: R 6 420,00
  Reported overdue amount: R 6 420,00
  Reported status: In default

Ground of dispute:
  This account was settled in full on the date reflected in my supporting evidence, but the bureau
  record has not been updated to reflect the settlement.

Consumer's statement:
  I settled this account in full on 14 March 2024 and attach the settlement letter.

In terms of section 72 of the National Credit Act 34 of 2005 and the regulations made under it, and
my right to correction of personal information under section 24 of the Protection of Personal
Information Act 4 of 2013, I request that you:
  1. Take reasonable steps to investigate the accuracy of the disputed information and respond
     within 20 business days of receipt of this dispute;
  2. Correct or remove any information found to be inaccurate, incomplete, out of date or
     unverifiable;
  3. Notify me in writing of the outcome of your investigation and of any amendment to my credit
     record.

If this dispute is not resolved to my satisfaction within that period, I reserve the right to refer
the matter to the Credit Ombud and, if unresolved, the National Credit Regulator in terms of
Chapter 7 of the National Credit Act.

Supporting evidence is attached.

Yours faithfully,

Thandi Nkosi
Submitted via CrediSync on behalf of, and with the consent of, the consumer named above.
```

### Questions

| #   | Statement in the product                                                                                               | Please confirm or correct                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | The right to challenge bureau information is **section 72 of the NCA "and the regulations made under it"**.            | Correct section? Should a specific regulation be cited? (An earlier draft cited s71, which we understand concerns removal of debt-review/judgment records.) |
| L2  | The bureau must respond within **20 business days** of receiving the dispute.                                          | Is 20 business days correct, and from _receipt_ (we count from the day we submit, on the SA calendar, excluding public holidays)? Exact source to cite?     |
| L3  | POPIA **section 24** (correction of personal information) is cited alongside the NCA.                                  | Appropriate to cite against a credit bureau, and correctly described?                                                                                       |
| L4  | Escalation path: **Credit Ombud**, then the **National Credit Regulator**, "in terms of Chapter 7".                    | Correct order and bodies? Should the National Consumer Tribunal be mentioned? Is "Chapter 7" the right reference?                                           |
| L5  | Consumers may escalate after a rejection, **or** once the bureau misses the response deadline.                         | Is escalation on a missed deadline correct?                                                                                                                 |
| L6  | CrediSync submits "on behalf of, and with the consent of" the consumer.                                                | Is a separate written mandate or power of attorney required for CrediSync to lodge on the consumer's behalf? Wording of that mandate?                       |
| L7  | Prescription ground: debt "has prescribed in terms of the Prescription Act 68 of 1969 and should no longer be listed". | Accurate, given prescription depends on facts (interruption, acknowledgment)? Should we warn consumers before selecting this ground?                        |
| L8  | Nine dispute grounds are offered (list in section 4 below).                                                            | Any grounds that should be added, reworded or removed?                                                                                                      |
| L9  | The lodging copy carries the **full ID number**; the consumer copy shows the last 4 digits.                            | Acceptable minimisation under POPIA s10? Does the bureau require the full number?                                                                           |
| L10 | Bureau postal addresses were removed until verified; the letter is addressed to "<Bureau> — Consumer Disputes".        | Any legal requirement on the channel (post, email, portal) for a dispute to be "lodged"?                                                                    |

---

## 2. Consent (POPIA s11)

At sign-up the consumer must accept the privacy notice (versioned; the version accepted is stored)
and may separately grant:

| Permission                     | Wording shown                                                                                                               | Can withdraw  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Privacy notice (required)      | "We process your personal information only to show your credit profile, help you dispute errors and assess bank readiness…" | Close account |
| Request my credit reports      | "Request my credit reports from TransUnion, Experian and XDS. Checking your own report does not affect your score."         | Yes           |
| Read my bank transactions      | "Used only to estimate affordability and bank readiness. Turning this off disconnects linked bank accounts."                | Yes           |
| Tips and product news          | Optional marketing.                                                                                                         | Yes           |
| Share my profile with partners | Off by default.                                                                                                             | Yes           |

Every change is recorded (who, when, old/new value, policy version, IP address, device).

| #   | Question                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Is "Checking your own report does not affect your score" accurate for all three bureaus and every product we will use?                                 |
| C2  | Is credit-check consent at sign-up sufficient for each later bureau pull, or must consent be refreshed per pull or per period (NCA s70 / regulations)? |
| C3  | Is our role a _responsible party_ for the consumer's data, an _operator_ for the bureaus, or both? Which operator agreements do we need?               |
| C4  | The privacy notice itself still needs drafting — please supply or approve the text (its version string is what we store).                              |

---

## 3. Retention (POPIA s14) and erasure (s24)

| Data                       | Current rule                                                                                                                                                                                           | Question                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Regulatory audit log       | Kept at least **5 years**, append-only; purged only after that.                                                                                                                                        | Is 5 years right? Longer for dispute records?                                               |
| Raw bank transactions      | **24 months**; monthly summaries kept until account deletion.                                                                                                                                          | Proportionate?                                                                              |
| Superseded credit profiles | **24 months**, unless a dispute references them.                                                                                                                                                       | Proportionate?                                                                              |
| Account deletion           | On request, after a **7-day** grace period: profile, reports, bank data, uploaded documents deleted; a pseudonymous audit trail (random id, no personal details) remains.                              | Is the retained trail lawful? Is 7 days acceptable?                                         |
| Disputes on deletion       | Deleted with the account.                                                                                                                                                                              | Must dispute records be kept for a period after account deletion?                           |
| Dispute evidence (closed)  | **24 months** (`EVIDENCE_RETENTION_MONTHS`) after the dispute closes: measured from escalation to the NCR / Credit Ombud (`ncr_escalated_at`) if escalated, otherwise from resolution (`resolved_at`). | Do escalated or Ombud cases need longer, e.g. until the Ombud or Tribunal matter is closed? |
| Dispute evidence (drafts)  | Deleted from drafts untouched for **90 days**; the draft letter is regenerated without the evidence wording. Unfinished uploads are deleted after **24 hours**.                                        | Proportionate?                                                                              |
| Deleted evidence copies    | Storage keeps a deleted file's previous version for up to **7 days** (bucket versioning, for recovery from operator error), then removes it.                                                           | Is a 7-day residual copy acceptable after erasure is reported?                              |

---

## 4. Dispute grounds offered

not my account · incorrect balance · incorrect status · paid but still reflecting · duplicate listing ·
identity theft / fraud · settled in full but not updated · prescribed debt · incorrect personal details.

---

## Recording sign-off

When the review is complete, a developer updates
`services/dispute-engine/src/templates/legal-references.ts`:

```ts
export const LEGAL_REVIEW = {
  reviewed: true,
  reviewedBy: '<name, firm>',
  reviewedOn: '<YYYY-MM-DD>',
};
```

and applies any corrected citations in the same file (`CITATIONS`). The draft banner disappears and
production letter generation is enabled. Consent wording lives in the web and mobile sign-up screens
and `PRODUCT.md`; retention periods in `packages/jobs/src/jobs.ts`.
