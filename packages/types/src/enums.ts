export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';

export type AccountStatus = 'current' | 'arrears' | 'default' | 'judgement' | 'written_off';

export type BureauSource = 'transunion' | 'experian' | 'xds';

export type DisputeStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'resolved_upheld'
  | 'resolved_rejected'
  | 'escalated_ncr';

export type DisputeReason =
  | 'not_my_account'
  | 'incorrect_balance'
  | 'incorrect_status'
  | 'paid_but_reflecting_outstanding'
  | 'duplicate_listing'
  | 'identity_theft_fraud'
  | 'settled_in_full_not_updated'
  | 'prescribed_debt'
  | 'incorrect_personal_details';

export type TransactionCategory =
  | 'income'
  | 'housing'
  | 'transport'
  | 'food_groceries'
  | 'utilities'
  | 'insurance'
  | 'debt_repayment'
  | 'savings'
  | 'entertainment'
  | 'healthcare'
  | 'education'
  | 'gambling'
  | 'transfers'
  | 'other';

export type IngestionSource = 'stitch' | 'ozow';

export type BankReadinessTier = 'prime' | 'near_prime' | 'sub_prime' | 'unqualified';

export type AuditEventType =
  | 'consent_granted'
  | 'consent_revoked'
  | 'data_access'
  | 'data_export'
  | 'data_deletion'
  | 'dispute_created'
  | 'dispute_submitted'
  | 'dispute_resolved'
  | 'bureau_refresh'
  | 'account_created'
  | 'account_updated'
  | 'account_locked'
  | 'login_success'
  | 'login_failure'
  | 'open_banking_linked';

export function getScoreBand(score: number): ScoreBand {
  if (score >= 767) return 'excellent';
  if (score >= 681) return 'good';
  if (score >= 614) return 'fair';
  if (score >= 583) return 'poor';
  return 'very_poor';
}
