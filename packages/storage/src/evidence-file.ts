import { current, MAX_EVIDENCE_BYTES } from './index';

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const MAX_NAME_LENGTH = 120;
const SNIFF_BYTES = 16;

export type EvidenceContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

/** Identifies a file by its magic bytes; the declared content type is never trusted. */
export function sniffEvidenceType(bytes: Buffer): EvidenceContentType | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '%PDF')
    return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  return null;
}

/** Makes a client-supplied file name safe to store, display and put in a header. */
export function sanitizeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[<>]/g, ' ')
    .replace(/["'`]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'evidence';
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

export type EvidenceVerification =
  | { ok: true; size: number }
  | { ok: false; reason: 'missing' | 'too_large' | 'type_mismatch' };

/** Checks an uploaded object exists, is within the size limit and really is the declared type. */
export async function verifyEvidenceObject(
  key: string,
  declaredType: string,
): Promise<EvidenceVerification> {
  const provider = current();
  const head = await provider.headObject(key);
  if (!head) return { ok: false, reason: 'missing' };
  if (head.size > MAX_EVIDENCE_BYTES) return { ok: false, reason: 'too_large' };
  const sniffed = sniffEvidenceType(await provider.readObjectStart(key, SNIFF_BYTES));
  if (!sniffed || sniffed !== declaredType) return { ok: false, reason: 'type_mismatch' };
  return { ok: true, size: head.size };
}

export async function createEvidenceDownloadUrl(key: string, fileName: string): Promise<string> {
  return current().presignDownload(key, DOWNLOAD_URL_TTL_SECONDS, fileName);
}

export async function deleteEvidenceObject(key: string): Promise<void> {
  await current().deleteObject(key);
}
