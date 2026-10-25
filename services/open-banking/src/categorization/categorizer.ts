import type { CategorizedTransaction, NormalizedTransaction, TransactionCategory } from '../types';

/**
 * Rule-based transaction categorizer tuned for South African merchants
 * and payment narrations. Rules are evaluated in order; the first match
 * wins, so more specific patterns must be listed before generic ones.
 *
 * This is intentionally a transparent, auditable v1 (POPIA/NCA context
 * means "why was this transaction classified as gambling" must have a
 * plain answer) — a Python NLP classifier can replace `categorize()`
 * later without changing the CategorizedTransaction contract.
 */
interface CategoryRule {
  category: TransactionCategory;
  pattern: RegExp;
}

const RULES: CategoryRule[] = [
  // Gambling — checked early; must never be mis-bucketed as entertainment
  { category: 'gambling', pattern: /\b(betway|hollywoodbets|sportingbet|supabets|betxchange|playabets|lotto|ithuba|casino|sunbet)\b/i },

  // Income
  { category: 'income', pattern: /\b(salary|payroll|wage|stipend|income\s*deposit)\b/i },

  // Housing
  { category: 'housing', pattern: /\b(rent|rental|bond\s*repayment|home\s*loan|levy|body\s*corporate|municipal\s*rates)\b/i },

  // Transport
  { category: 'transport', pattern: /\b(uber|bolt|gautrain|metrorail|taxi|engen|sasol|shell|bp\s*garage|caltex|toll\s*fee|sanral)\b/i },

  // Food & groceries
  { category: 'food_groceries', pattern: /\b(checkers|pick\s*n\s*pay|pnp|woolworths|shoprite|spar|food\s*lovers|makro|game\s*stores|uber\s*eats|mr\s*delivery|takealot\s*grocery)\b/i },

  // Utilities
  { category: 'utilities', pattern: /\b(eskom|city\s*power|prepaid\s*electricity|municipal\s*services|telkom|vodacom|mtn|cell\s*c|rain|dstv|showmax|fibre|internet)\b/i },

  // Insurance
  { category: 'insurance', pattern: /\b(discovery|outsurance|momentum|santam|hollard|old\s*mutual\s*insure|budget\s*insurance|insurance\s*premium)\b/i },

  // Debt repayment
  { category: 'debt_repayment', pattern: /\b(loan\s*repayment|instalment|capitec\s*loan|absa\s*loan|fnb\s*loan|nedbank\s*loan|standard\s*bank\s*loan|credit\s*card\s*payment|debt\s*review)\b/i },

  // Savings
  { category: 'savings', pattern: /\b(savings\s*account|unit\s*trust|easy\s*equities|allan\s*gray|satrix|tax\s*free\s*savings|fixed\s*deposit)\b/i },

  // Entertainment
  { category: 'entertainment', pattern: /\b(netflix|spotify|cinema|ster\s*kinekor|nu\s*metro|steam|playstation|xbox|bar\b|restaurant|pub\b)\b/i },

  // Healthcare
  { category: 'healthcare', pattern: /\b(clicks|dischem|dis-chem|pharmacy|medical\s*aid|discovery\s*health|doctor|hospital|dentist)\b/i },

  // Education
  { category: 'education', pattern: /\b(school\s*fees|university|varsity|tuition|unisa|study\s*loan|textbook)\b/i },

  // Transfers
  { category: 'transfers', pattern: /\b(eft\s*transfer|internal\s*transfer|payshap|instant\s*eft|own\s*account\s*transfer)\b/i },
];

export function categorize(transaction: NormalizedTransaction): TransactionCategory {
  const haystack = `${transaction.description} ${transaction.merchantName ?? ''}`;

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }

  // Unmatched credits are treated as income (a conservative default for
  // affordability calculations); unmatched debits fall through to 'other'
  // rather than being guessed into a specific spend category.
  return transaction.amount > 0 ? 'income' : 'other';
}

export function categorizeAll(transactions: NormalizedTransaction[]): CategorizedTransaction[] {
  return transactions.map((t) => ({ ...t, category: categorize(t) }));
}
