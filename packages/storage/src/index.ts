import { randomUUID } from 'crypto';
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  current,
  type PresignedUpload,
} from './provider';

export * from './provider';

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceValidationError';
  }
}

export function userPrefix(userId: string): string {
  return `uploads/${userId}/`;
}

/** Presigned upload for one evidence file. The key is generated here, never chosen by the client. */
export async function createEvidenceUpload(
  userId: string,
  contentType: string,
  contentLength: number,
): Promise<PresignedUpload> {
  const ext = ALLOWED_EVIDENCE_TYPES[contentType];
  if (!ext) throw new EvidenceValidationError('Upload a PDF, JPEG or PNG file');
  if (
    !Number.isInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_EVIDENCE_BYTES
  ) {
    throw new EvidenceValidationError('Files must be smaller than 10 MB');
  }
  const key = `${userPrefix(userId)}${randomUUID()}.${ext}`;
  return current().presignUpload(key, contentType, contentLength, UPLOAD_URL_TTL_SECONDS);
}

/** POPIA erasure: removes every object the user uploaded. */
export async function deleteUserFiles(userId: string): Promise<number> {
  return current().deletePrefix(userPrefix(userId));
}

export * from './evidence-file';
export { InMemoryStorageProvider } from './memory-provider';

/** A fresh upload link for an existing evidence key, whose first link may have expired. */
export async function createEvidenceRetryUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<PresignedUpload> {
  return current().presignUpload(key, contentType, contentLength, UPLOAD_URL_TTL_SECONDS);
}
