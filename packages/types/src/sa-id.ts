/**
 * South African ID number: YYMMDD SSSS C A Z (13 digits)
 *   YYMMDD – date of birth
 *   SSSS   – sequence (0000–4999 female, 5000–9999 male)
 *   C      – citizenship (0 = citizen, 1 = permanent resident)
 *   A      – historical race digit, now always 8 or 9
 *   Z      – Luhn check digit
 */
export interface SaIdValidation {
  valid: boolean;
  reason?: 'format' | 'date' | 'citizenship' | 'checksum';
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function validateSaIdNumber(raw: string, today: Date = new Date()): SaIdValidation {
  const id = raw.replace(/\s+/g, '');
  if (!/^\d{13}$/.test(id)) return { valid: false, reason: 'format' };

  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  const currentYY = today.getUTCFullYear() % 100;
  const year = yy <= currentYY ? 2000 + yy : 1900 + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) {
    return { valid: false, reason: 'date' };
  }

  if (id[10] !== '0' && id[10] !== '1') return { valid: false, reason: 'citizenship' };
  if (!luhnValid(id)) return { valid: false, reason: 'checksum' };
  return { valid: true };
}

export function normaliseSaIdNumber(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** Display mask that never reveals date of birth: *********0874 → shows last 4 only. */
export function maskSaIdNumber(raw: string): string {
  const id = normaliseSaIdNumber(raw);
  if (id.length < 4) return '*************';
  return `${'*'.repeat(id.length - 4)}${id.slice(-4)}`;
}
