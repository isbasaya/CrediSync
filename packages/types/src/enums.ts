/**
 * Domain enums shared by every TypeScript service and the web/admin apps.
 * Values MUST match the PostgreSQL enums in db/schema.sql 1:1 (a test in
 * packages/types checks this) and the design tokens in design-system/tokens.ts.
 */

export const SCORE_BANDS = ['excellent', 'good', 'fair', 'poor', 'very_poor'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const ACCOUNT_STATUSES = ['current', 'arrears', 'default', 'judgement', 'written_off', 'unknown'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const BUREAU_SOURCES = ['transunion', 'experian', 'xds'] as const;
export type BureauSource = (typeof BUREAU_SOURCES)[number];

export const DISPUTE_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'resolved_upheld',
  'resolved_rejected',
  'escalated_ncr',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_REASONS = [
  'not_my_account',
  'incorrect_balance',
  'incorrect_status',
  'paid_but_reflecting_outstanding',
  'duplicate_listing',
  'identity_theft_fraud',
  'settled_in_full_not_updated',
  'prescribed_debt',
  'incorrect_personal_details',
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const TRANSACTION_CATEGORIES = [
  'income',
  'housing',
  'transport',
  'food_groceries',
  'utilities',
  'insurance',
  'debt_repayment',
  'savings',
  'entertainment',
  'healthcare',
  'education',
  'gambling',
  'transfers',
  'other',
] as const;
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export const INGESTION_SOURCES = ['stitch', 'ozow'] as const;
export type IngestionSource = (typeof INGESTION_SOURCES)[number];

export const BANK_READINESS_TIERS = ['prime', 'near_prime', 'sub_prime', 'unqualified'] as const;
export type BankReadinessTier = (typeof BANK_READINESS_TIERS)[number];

export const USER_ROLES = ['consumer', 'admin', 'compliance_officer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const AUDIT_EVENT_TYPES = [
  'user_registered',
  'user_login',
  'user_login_failed',
  'user_logout',
  'account_locked',
  'email_verified',
  'consent_granted',
  'consent_revoked',
  'data_access',
  'data_export',
  'data_deletion_request',
  'data_deletion_completed',
  'bureau_pull',
  'bank_link_created',
  'bank_data_ingested',
  'dispute_created',
  'dispute_submitted',
  'dispute_bureau_response',
  'dispute_resolved',
  'dispute_escalated',
  'dispute_deadline_breached',
  'score_computed',
  'bank_readiness_scored',
  'ai_entity_merge',
  'admin_access',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Account statuses that count as adverse on a credit profile. */
export const ADVERSE_ACCOUNT_STATUSES: ReadonlySet<AccountStatus> = new Set([
  'arrears',
  'default',
  'judgement',
  'written_off',
]);

export function getScoreBand(score: number): ScoreBand {
  if (score >= 767) return 'excellent';
  if (score >= 681) return 'good';
  if (score >= 614) return 'fair';
  if (score >= 583) return 'poor';
  return 'very_poor';
}
