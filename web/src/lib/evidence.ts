/** Client-side checks that mirror the dispute engine's limits, so users hear about them before uploading. */

export const EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 10;

/** What the file input offers. The server still checks the file's real contents. */
export const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export function validateEvidenceFile(
  file: { type: string; size: number },
  existingCount: number,
): string | null {
  if (existingCount >= MAX_EVIDENCE_FILES)
    return `You can attach up to ${MAX_EVIDENCE_FILES} files`;
  if (!(EVIDENCE_TYPES as readonly string[]).includes(file.type))
    return 'Upload a PDF, JPEG or PNG file';
  if (file.size <= 0) return 'This file is empty';
  if (file.size > MAX_EVIDENCE_BYTES) return 'Files must be smaller than 10 MB';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trim(kb)} KB`;
  return `${trim(kb / 1024)} MB`;
}

const trim = (n: number) => String(Number(n.toFixed(1)));
