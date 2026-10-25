import { randomUUID } from 'crypto';
import pino from 'pino';
import { isLocalEnv } from '@credisync/config';

const logger = pino({ name: 'storage' });

/**
 * Evidence files (proof of payment, police reports) are personal
 * information. Uploads go straight from the client to S3 (af-south-1, KMS
 * encrypted) with short-lived presigned URLs, under a key prefix owned by
 * the uploading user, so services never stream file bodies.
 */

export const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  expiresIn: number;
  /** Headers the client must send with the PUT. */
  requiredHeaders: Record<string, string>;
}

export interface StorageProvider {
  presignUpload(key: string, contentType: string, contentLength: number, expiresIn: number): Promise<PresignedUpload>;
  presignDownload(key: string, expiresIn: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly baseUrl = process.env.STORAGE_BASE_URL ?? 'http://localhost:9000';

  constructor() {
    if (!isLocalEnv()) throw new Error('LocalStorageProvider is only available in development and test');
  }

  async presignUpload(key: string, contentType: string, _contentLength: number, expiresIn: number): Promise<PresignedUpload> {
    return { uploadUrl: `${this.baseUrl}/upload/${key}`, key, expiresIn, requiredHeaders: { 'Content-Type': contentType } };
  }

  async presignDownload(key: string, expiresIn: number): Promise<string> {
    return `${this.baseUrl}/download/${key}?expires=${expiresIn}`;
  }

  async deleteObject(key: string): Promise<void> {
    logger.info({ key }, 'deleting object (local)');
  }

  async deletePrefix(prefix: string): Promise<number> {
    logger.info({ prefix }, 'deleting prefix (local)');
    return 0;
  }
}

/** S3 provider; the AWS SDK is loaded lazily so local development needs no AWS credentials. */
export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly bucket: string,
    private readonly kmsKeyId: string,
    private readonly region: string = process.env.AWS_REGION ?? 'af-south-1'
  ) {
    if (region !== 'af-south-1') throw new Error(`S3 region must be af-south-1 (data residency); got ${region}`);
  }

  private async sdk() {
    const [s3, presigner] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
    return { s3, presigner, client: new s3.S3Client({ region: this.region }) };
  }

  async presignUpload(key: string, contentType: string, contentLength: number, expiresIn: number): Promise<PresignedUpload> {
    const { s3, presigner, client } = await this.sdk();
    const command = new s3.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.kmsKeyId,
    });
    const uploadUrl = await presigner.getSignedUrl(client, command, { expiresIn });
    return {
      uploadUrl,
      key,
      expiresIn,
      requiredHeaders: {
        'Content-Type': contentType,
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': this.kmsKeyId,
      },
    };
  }

  async presignDownload(key: string, expiresIn: number): Promise<string> {
    const { s3, presigner, client } = await this.sdk();
    return presigner.getSignedUrl(client, new s3.GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async deleteObject(key: string): Promise<void> {
    const { s3, client } = await this.sdk();
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    const { s3, client } = await this.sdk();
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await client.send(new s3.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await client.send(new s3.DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}

let provider: StorageProvider | null = null;

function current(): StorageProvider {
  if (!provider) {
    const bucket = process.env.EVIDENCE_BUCKET;
    const kmsKeyId = process.env.KMS_KEY_ID;
    provider = bucket && kmsKeyId ? new S3StorageProvider(bucket, kmsKeyId) : new LocalStorageProvider();
  }
  return provider;
}

export function setStorageProvider(p: StorageProvider | null): void {
  provider = p;
}

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
export async function createEvidenceUpload(userId: string, contentType: string, contentLength: number): Promise<PresignedUpload> {
  const ext = ALLOWED_EVIDENCE_TYPES[contentType];
  if (!ext) throw new EvidenceValidationError('Upload a PDF, JPEG or PNG file');
  if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_EVIDENCE_BYTES) {
    throw new EvidenceValidationError('Files must be smaller than 10 MB');
  }
  const key = `${userPrefix(userId)}${randomUUID()}.${ext}`;
  return current().presignUpload(key, contentType, contentLength, UPLOAD_URL_TTL_SECONDS);
}

export async function createEvidenceDownloadUrl(key: string): Promise<string> {
  return current().presignDownload(key, DOWNLOAD_URL_TTL_SECONDS);
}

/** POPIA erasure: removes every object the user uploaded. */
export async function deleteUserFiles(userId: string): Promise<number> {
  return current().deletePrefix(userPrefix(userId));
}
