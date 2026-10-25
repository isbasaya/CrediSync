import type { CategorizedTransaction, NormalizedTransaction, TransactionCategory } from '../types';

/**
 * Rule-based transaction categorizer tuned for South African merchants and
 * payment narrations. Rules are evaluated in order and the first match
 * wins, so more specific patterns come before generic ones.
 *
 * Transparent and auditable on purpose ("why was this classified as
 * gambling?" must have a plain answer). A trained classifier can replace
 * categorize() later without changing the CategorizedTransaction contract.
 */
interface CategoryRule {
  category: TransactionCategory;
  pattern: RegExp;
  /** Restrict a rule to money in or money out. */
  direction?: 'credit' | 'debit';
}

const RULES: CategoryRule[] = [
  // Own-account movements and reversals are not income or spend.
  {
    category: 'transfers',
    pattern: /\b(own\s*account|internal\s*transfer|transfer\s*(from|to)\s*(savings|cheque|credit\s*card)|inter[-\s]?account|reversal|refund)\b/i,
  },
  // Gambling — checked early; must never be bucketed as entertainment.
  { category: 'gambling', pattern: /\b(betway|hollywoodbets|sportingbet|supabets|betxchange|playabets|lotto|ithuba|casino|sunbet|10bet|easybet)\b/i },

  // Income: only money IN that looks like earnings or grants.
  {
    category: 'income',
    direction: 'credit',
    pattern: /\b(salary|salaries|payroll|wage|wages|stipend|commission|pension|sassa|social\s*grant|uif\s*payment|income\s*deposit)\b/i,
  },

  // Housing
  { category: 'housing', pattern: /\b(rent|rental|bond\s*repayment|home\s*loan|levy|levies|body\s*corporate|municipal\s*rates)\b/i },

  // Transport
  { category: 'transport', pattern: /\b(uber(?!\s*eats)|bolt|gautrain|metrorail|taxi|engen|sasol|shell|bp\s*garage|caltex|astron|toll\s*fee|sanral|e-?toll)\b/i },

  // Food & groceries
  { category: 'food_groceries', pattern: /\b(checkers|pick\s*n\s*pay|pnp|woolworths\s*food|woolworths|shoprite|spar|food\s*lovers|makro|uber\s*eats|mr\s*d|mr\s*delivery|takealot\s*grocery|boxer|usave)\b/i },

  // Healthcare (before insurance so "Discovery Health" isn't counted as insurance)
  { category: 'healthcare', pattern: /\b(clicks|dischem|dis-chem|pharmacy|medical\s*aid|discovery\s*health|bonitas|gems|doctor|hospital|dentist|netcare|mediclinic)\b/i },

  // Utilities
  { category: 'utilities', pattern: /\b(eskom|city\s*power|prepaid\s*electricity|municipal\s*services|telkom|vodacom|mtn|cell\s*c|rain|dstv|showmax|fibre|internet|airtime|data\s*bundle)\b/i },

  // Insurance
  { category: 'insurance', pattern: /\b(discovery|outsurance|momentum|santam|hollard|old\s*mutual|sanlam|budget\s*insurance|miway|king\s*price|insurance\s*premium|funeral\s*(cover|plan|policy))\b/i },

  // Debt repayment
  { category: 'debt_repayment', pattern: /\b(loan\s*repayment|instalment|installment|capitec\s*loan|absa\s*loan|fnb\s*loan|nedbank\s*loan|standard\s*bank\s*loan|credit\s*card\s*payment|debt\s*review|vehicle\s*finance|wesbank|mfc)\b/i },

  // Savings
  { category: 'savings', pattern: /\b(savings\s*account|unit\s*trust|easy\s*equities|allan\s*gray|satrix|tax\s*free\s*savings|fixed\s*deposit|stokvel)\b/i },

  // Entertainment
  { category: 'entertainment', pattern: /\b(netflix|spotify|cinema|ster\s*kinekor|nu\s*metro|steam|playstation|xbox|bar|restaurant|pub)\b/i },

  // Education
  { category: 'education', pattern: /\b(school\s*fees|university|varsity|tuition|unisa|study\s*loan|textbook|creche)\b/i },

  // Generic payments between people
  { category: 'transfers', pattern: /\b(eft\s*transfer|payshap|instant\s*eft|immediate\s*payment|send\s*money|ewallet|e-wallet)\b/i },
];

export function categorize(transaction: NormalizedTransaction): TransactionCategory {
  const haystack = `${transaction.description} ${transaction.merchantName ?? ''}`;
  const direction = transaction.amount >= 0 ? 'credit' : 'debit';

  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.pattern.test(haystack)) return rule.category;
  }

  // Unmatched money (in or out) is 'other'. Unmatched credits are NOT
  // assumed to be income: refunds, loan payouts and transfers from family
  // would otherwise inflate affordability (a reckless-lending risk).
  return 'other';
}

export function categorizeAll(transactions: NormalizedTransaction[]): CategorizedTransaction[] {
  return transactions.map((t) => ({ ...t, category: categorize(t) }));
}
