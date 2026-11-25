import { describe, it, expect, beforeAll } from 'vitest';
import {
  contentDisposition,
  LocalStorageProvider,
  providerFromEnv,
  S3StorageProvider,
} from '../index';

beforeAll(() => {
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
});

describe('contentDisposition', () => {
  it('is always an attachment', () => {
    expect(contentDisposition('proof.pdf')).toMatch(/^attachment; /);
  });

  it('neutralises quotes, backslashes and percent signs in the fallback name', () => {
    const header = contentDisposition('a"b\\c%d.pdf');
    expect(header).toContain('filename="a_b_c_d.pdf"');
    expect(header).toContain("filename*=UTF-8''a%22b%5Cc%25d.pdf");
  });

  it('cannot be used to inject headers via CRLF', () => {
    const header = contentDisposition('a\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="a__Set-Cookie: x=1.pdf"');
    expect(header).toContain('%0D%0A');
  });

  it('keeps unicode names in filename* and an ASCII fallback', () => {
    const header = contentDisposition('béér ✓.pdf');
    expect(header).toContain('filename="b__r _.pdf"');
    expect(header).toContain("filename*=UTF-8''b%C3%A9%C3%A9r%20%E2%9C%93.pdf");
  });

  it("percent-encodes ' ( ) * in filename*", () => {
    const header = contentDisposition("it's (1)*.pdf");
    expect(header).toContain("filename*=UTF-8''it%27s%20%281%29%2A.pdf");
  });
});

describe('S3StorageProvider', () => {
  const provider = () => new S3StorageProvider('bucket', 'kms-key', 'af-south-1');

  it('always forces attachment and no-store on downloads, even without a file name', async () => {
    const url = new URL(await provider().presignDownload('k.pdf', 300));
    expect(url.searchParams.get('response-content-disposition')).toMatch(
      /^attachment; filename="evidence"/,
    );
    expect(url.searchParams.get('response-cache-control')).toBe('no-store');
  });

  it('uses the supplied file name in the disposition', async () => {
    const url = new URL(await provider().presignDownload('k.pdf', 300, 'proof.pdf'));
    expect(url.searchParams.get('response-content-disposition')).toContain('filename="proof.pdf"');
  });

  it('makes uploads create-only and signs the header', async () => {
    const up = await provider().presignUpload('k.pdf', 'application/pdf', 10, 900);
    expect(up.requiredHeaders['If-None-Match']).toBe('*');
    const signed = new URL(up.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toContain('if-none-match');
    expect(signed.split(';')).toContain('x-amz-server-side-encryption');
  });

  it('keeps create-only on the local endpoint path too', async () => {
    const p = new S3StorageProvider('bucket', 'kms-key', 'af-south-1', {
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9000',
    });
    const up = await p.presignUpload('k.pdf', 'application/pdf', 10, 900);
    expect(up.uploadUrl.startsWith('http://localhost:9000/')).toBe(true);
    expect(up.requiredHeaders['If-None-Match']).toBe('*');
    expect(up.requiredHeaders['x-amz-server-side-encryption']).toBeUndefined();
    const signed = new URL(up.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toContain('if-none-match');
  });

  it('does not bake a checksum of the empty body into the presigned PUT URL', async () => {
    const up = await provider().presignUpload('k.pdf', 'application/pdf', 10, 900);
    const q = new URL(up.uploadUrl).searchParams;
    expect([...q.keys()].filter((k) => k.toLowerCase().includes('checksum'))).toEqual([]);
  });

  it('maps a 404 on HEAD to null and rethrows other errors', async () => {
    const p = provider();
    const stub = (err: unknown) =>
      Object.assign(p as object, {
        sdk: async () => ({
          s3: { HeadObjectCommand: class {} },
          client: {
            send: async () => {
              throw err;
            },
          },
        }),
      });
    stub(Object.assign(new Error('x'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
    expect(await p.headObject('k')).toBeNull();
    stub(
      Object.assign(new Error('x'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    );
    await expect(p.headObject('k')).rejects.toThrow();
  });
});

describe('providerFromEnv', () => {
  const base = { NODE_ENV: 'development', AWS_REGION: 'af-south-1' };

  it('uses MinIO without a KMS key, which would also switch field encryption to real KMS', () => {
    const p = providerFromEnv({
      ...base,
      EVIDENCE_BUCKET: 'b',
      S3_ENDPOINT: 'http://minio:9000',
    });
    expect(p).toBeInstanceOf(S3StorageProvider);
  });

  it('stays on the local stub without a bucket, or with a bucket but no endpoint or key', () => {
    expect(providerFromEnv(base)).toBeInstanceOf(LocalStorageProvider);
    expect(providerFromEnv({ ...base, EVIDENCE_BUCKET: 'b' })).toBeInstanceOf(LocalStorageProvider);
  });

  it('ignores a local endpoint outside development and test', () => {
    const env = { NODE_ENV: 'production', EVIDENCE_BUCKET: 'b', S3_ENDPOINT: 'http://minio:9000' };
    expect(providerFromEnv(env)).toBeInstanceOf(LocalStorageProvider);
    expect(providerFromEnv({ ...env, KMS_KEY_ID: 'k' })).toBeInstanceOf(S3StorageProvider);
  });
});
