# Regulatory figures used in calculations

**For:** compliance. These numbers drive what consumers see. Each one is configurable without a code
change; please confirm each against the current gazette or regulator guidance and record the date.

## NCA minimum monthly expense norms

Used to make sure the "left over after costs" figure never assumes living costs lower than the
regulatory minimum for the consumer's income.

Source: National Credit Regulations, Affordability Assessment Regulations (2015), regulation 23A,
Table 1 ("Minimum Expense Norms").

| Monthly gross income | Fixed amount | Plus % of income above the band's lower limit |
| -------------------- | -----------: | --------------------------------------------: |
| R0 – R800            |      R800.00 |                                            0% |
| R800.01 – R6,250     |      R800.00 |                                         6.75% |
| R6,250.01 – R25,000  |    R1,167.88 |                                            9% |
| R25,000.01 – R50,000 |    R2,855.38 |                                          8.2% |
| R50,000.01 and above |    R4,905.38 |                                         6.75% |

**To confirm:**

- That these are still the current figures. A 2015 version is widely reproduced; a later amendment
  was proposed (including excluding small businesses from the table). We could not confirm whether
  amended figures were gazetted.
- The table is defined on **gross** income. Bank feeds only show money received after tax, so the
  product currently looks up the norm using observed income. That produces a slightly _lower_ norm
  than a gross-income lookup would. Acceptable, or should we gross up?

Configured in `services/open-banking/src/aggregation/expense-norms.ts`; override with the
`NCA_EXPENSE_NORMS` environment variable, a JSON array of `{ min, max, fixed, rate }`.

References consulted (secondary sources; the gazette is authoritative):

- [Regulation 23A text and Table 1](https://www.acts.co.za/national-credit/r489_23a__criteria_to_conduc)
- [LitNet: a closer look at the affordability assessment regulations](https://www.litnet.co.za/a-closer-look-at-the-new-affordability-assessment-regulations-in-terms-of-the-national-credit-act-34-of-2005/)
- [Mondaq: proposed amendments](https://www.mondaq.com/article/1703512)

## Dispute response period

20 business days, counted from the South African calendar date of submission, excluding weekends,
statutory public holidays (including the Sunday-to-Monday rule) and any one-off holidays an operator
adds to `public_holiday_overrides` (e.g. election days). Citation under review (legal pack L1, L2).
Code: `services/dispute-engine/src/deadlines.ts`.

## Retention periods

| Data                       | Period                                     | Setting                                   |
| -------------------------- | ------------------------------------------ | ----------------------------------------- |
| Regulatory audit log       | 5 years minimum                            | Fixed in the database trigger and job     |
| Raw bank transactions      | 24 months                                  | `TRANSACTION_RETENTION_MONTHS`            |
| Superseded credit profiles | 24 months (unless disputed)                | `PROFILE_HISTORY_RETENTION_MONTHS`        |
| Published outbox events    | 7 days                                     | `packages/jobs/src/jobs.ts`               |
| Deletion grace period      | 7 days                                     | `services/auth/src/service.ts`            |
| Dispute evidence           | 24 months from escalation, else resolution | `EVIDENCE_RETENTION_MONTHS`               |
| Evidence on idle drafts    | 90 days                                    | `packages/jobs/src/jobs.ts`               |
| Unfinished evidence upload | 24 hours                                   | `services/dispute-engine/src/evidence.ts` |
| Deleted evidence versions  | 7 days                                     | `infra/terraform/data.tf` (lifecycle)     |

## Score bands

Excellent 767+, good 681–766, fair 614–680, poor 583–613, very poor below 583, applied to scores
normalised to 0–999 (see the bureau checklist, item B5). Confirm these bands are appropriate for
consumer-facing labels across all three bureaus.

## Sign-off

| Figure            | Confirmed by | Date | Source |
| ----------------- | ------------ | ---- | ------ |
| Expense norms     |              |      |        |
| Response period   |              |      |        |
| Retention periods |              |      |        |
| Score bands       |              |      |        |
