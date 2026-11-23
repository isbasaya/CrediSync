import type { PresignedUpload, StorageProvider } from './provider';

/** In-memory provider for tests; never selected automatically. */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  /** When true, deleteObject rejects, to exercise retry paths. */
  failDeletes = false;

  put(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  async presignUpload(
    key: string,
    contentType: string,
    _contentLength: number,
    expiresIn: number,
  ): Promise<PresignedUpload> {
    return {
      uploadUrl: `memory://upload/${key}`,
      key,
      expiresIn,
      requiredHeaders: { 'Content-Type': contentType },
    };
  }

  async presignDownload(key: string, expiresIn: number, fileName?: string): Promise<string> {
    const name = fileName ? `&name=${encodeURIComponent(fileName)}` : '';
    return `memory://download/${key}?expires=${expiresIn}${name}`;
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.length } : null;
  }

  async readObjectStart(key: string, bytes: number): Promise<Buffer> {
    const o = this.objects.get(key);
    return o ? Buffer.from(o.body.subarray(0, bytes)) : Buffer.alloc(0);
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failDeletes) throw new Error('delete failed');
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(prefix)) {
        this.objects.delete(k);
        n++;
      }
    }
    return n;
  }
}
