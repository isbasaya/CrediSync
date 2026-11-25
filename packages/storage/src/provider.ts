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
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  expiresIn: number;
  /** Headers the client must send with the PUT. */
  requiredHeaders: Record<string, string>;
}

export interface StorageProvider {
  presignUpload(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn: number,
  ): Promise<PresignedUpload>;
  presignDownload(key: string, expiresIn: number, fileName?: string): Promise<string>;
  /** Size of the stored object, or null when it does not exist. */
  headObject(key: string): Promise<{ size: number } | null>;
  /** The first `bytes` bytes of the object, for content-signature checks. */
  readObjectStart(key: string, bytes: number): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly baseUrl = process.env.STORAGE_BASE_URL ?? 'http://localhost:9000';

  constructor() {
    if (!isLocalEnv())
      throw new Error('LocalStorageProvider is only available in development and test');
  }

  async presignUpload(
    key: string,
    contentType: string,
    _contentLength: number,
    expiresIn: number,
  ): Promise<PresignedUpload> {
    return {
      uploadUrl: `${this.baseUrl}/upload/${key}`,
      key,
      expiresIn,
      requiredHeaders: { 'Content-Type': contentType },
    };
  }

  async presignDownload(key: string, expiresIn: number, fileName?: string): Promise<string> {
    const name = fileName ? `&name=${encodeURIComponent(fileName)}` : '';
    return `${this.baseUrl}/download/${key}?expires=${expiresIn}${name}`;
  }

  /** No bucket is configured locally, so no object can ever be found. */
  async headObject(_key: string): Promise<{ size: number } | null> {
    return null;
  }

  async readObjectStart(_key: string, _bytes: number): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  async deleteObject(key: string): Promise<void> {
    logger.info({ key }, 'deleting object (local)');
  }

  async deletePrefix(prefix: string): Promise<number> {
    logger.info({ prefix }, 'deleting prefix (local)');
    return 0;
  }
}

export interface S3ProviderOptions {
  /** Service endpoint override (MinIO). Local and test environments only. */
  endpoint?: string;
  /** Endpoint browsers use when it differs from the service one (localhost vs docker host). */
  publicEndpoint?: string;
}

const SSE_HEADERS = ['x-amz-server-side-encryption', 'x-amz-server-side-encryption-aws-kms-key-id'];

/** RFC 6266 Content-Disposition with an ASCII fallback and an RFC 5987 `filename*`. */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** S3 provider; the AWS SDK is loaded lazily so local development needs no AWS credentials. */
export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly bucket: string,
    private readonly kmsKeyId: string,
    private readonly region: string = process.env.AWS_REGION ?? 'af-south-1',
    private readonly options: S3ProviderOptions = {},
  ) {
    if (region !== 'af-south-1')
      throw new Error(`S3 region must be af-south-1 (data residency); got ${region}`);
    if ((options.endpoint || options.publicEndpoint) && !isLocalEnv())
      throw new Error('S3 endpoint overrides are only available in development and test');
  }

  private async sdk() {
    const [s3, presigner] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const { endpoint, publicEndpoint } = this.options;
    const make = (ep?: string) =>
      new s3.S3Client({
        region: this.region,
        // Without this the SDK bakes the CRC32 of an empty body into presigned PUT URLs, which
        // real S3 rejects (BadDigest) for any non-empty upload; MinIO ignores it.
        requestChecksumCalculation: 'WHEN_REQUIRED' as const,
        ...(ep ? { endpoint: ep, forcePathStyle: true } : {}),
      });
    const client = make(endpoint);
    // Presigned URLs are opened by browsers, which may reach the store on another host name.
    const signer = publicEndpoint ? make(publicEndpoint) : client;
    return { s3, presigner, client, signer };
  }

  async presignUpload(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn: number,
  ): Promise<PresignedUpload> {
    const { s3, presigner, signer } = await this.sdk();
    // MinIO has no KMS, so SSE is only requested against real S3.
    const sse = !this.options.endpoint;
    const command = new s3.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      // Create-only: a verified object can never be overwritten through a still-valid URL.
      IfNoneMatch: '*',
      ...(sse ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: this.kmsKeyId } : {}),
    });
    const uploadUrl = await presigner.getSignedUrl(signer, command, {
      expiresIn,
      // Sign the SSE headers so the ones in requiredHeaders are the ones enforced.
      unhoistableHeaders: new Set(sse ? [...SSE_HEADERS, 'if-none-match'] : ['if-none-match']),
    });
    return {
      uploadUrl,
      key,
      expiresIn,
      requiredHeaders: {
        'Content-Type': contentType,
        'If-None-Match': '*',
        ...(sse
          ? {
              'x-amz-server-side-encryption': 'aws:kms',
              'x-amz-server-side-encryption-aws-kms-key-id': this.kmsKeyId,
            }
          : {}),
      },
    };
  }

  async presignDownload(key: string, expiresIn: number, fileName?: string): Promise<string> {
    const { s3, presigner, signer } = await this.sdk();
    return presigner.getSignedUrl(
      signer,
      new s3.GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseCacheControl: 'no-store',
        // Always an attachment, whatever the caller passes, so files never render inline.
        ResponseContentDisposition: contentDisposition(fileName || 'evidence'),
      }),
      { expiresIn },
    );
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const { s3, client } = await this.sdk();
    try {
      const head = await client.send(new s3.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0 };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404)
        return null;
      throw err;
    }
  }

  async readObjectStart(key: string, bytes: number): Promise<Buffer> {
    const { s3, client } = await this.sdk();
    const res = await client.send(
      new s3.GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    if (!res.Body) return Buffer.alloc(0);
    return Buffer.from(await res.Body.transformToByteArray());
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
      const page = await client.send(
        new s3.ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await client.send(
          new s3.DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }),
        );
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}

let provider: StorageProvider | null = null;

/**
 * Picks the provider from the environment. Real S3 needs a KMS key for SSE. A local
 * MinIO endpoint does not, and KMS_KEY_ID also switches field encryption to real KMS,
 * so a local endpoint works without one.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const bucket = env.EVIDENCE_BUCKET;
  const local = isLocalEnv(env);
  const endpoint = local ? env.S3_ENDPOINT || undefined : undefined;
  const kmsKeyId = env.KMS_KEY_ID || (endpoint ? 'local-minio-no-kms' : undefined);
  if (!bucket || !kmsKeyId) return new LocalStorageProvider();
  // Endpoint overrides (MinIO) are never honoured outside local and test environments.
  const options: S3ProviderOptions = local
    ? { endpoint, publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined }
    : {};
  return new S3StorageProvider(bucket, kmsKeyId, env.AWS_REGION ?? 'af-south-1', options);
}

export function current(): StorageProvider {
  if (!provider) provider = providerFromEnv();
  return provider;
}

export function setStorageProvider(p: StorageProvider | null): void {
  provider = p;
}
