import { describe, it, expect, vi, afterEach } from 'vitest';
import { putEvidenceFile } from '../api-client';
import {
  EVIDENCE_TYPES,
  formatFileSize,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  validateEvidenceFile,
} from '../evidence';

afterEach(() => vi.unstubAllGlobals());

describe('validateEvidenceFile', () => {
  it.each(EVIDENCE_TYPES)('accepts %s at exactly 10 MB', (type) => {
    expect(validateEvidenceFile({ type, size: MAX_EVIDENCE_BYTES }, 0)).toBeNull();
  });

  it('rejects one byte over 10 MB', () => {
    expect(validateEvidenceFile({ type: 'application/pdf', size: MAX_EVIDENCE_BYTES + 1 }, 0)).toBe(
      'Files must be smaller than 10 MB',
    );
  });

  it('rejects empty files and other types', () => {
    expect(validateEvidenceFile({ type: 'application/pdf', size: 0 }, 0)).toBe(
      'This file is empty',
    );
    for (const type of ['application/x-msdownload', 'image/gif', '']) {
      expect(validateEvidenceFile({ type, size: 100 }, 0)).toBe('Upload a PDF, JPEG or PNG file');
    }
  });

  it('rejects an 11th file', () => {
    expect(
      validateEvidenceFile({ type: 'image/png', size: 100 }, MAX_EVIDENCE_FILES - 1),
    ).toBeNull();
    expect(validateEvidenceFile({ type: 'image/png', size: 100 }, MAX_EVIDENCE_FILES)).toBe(
      'You can attach up to 10 files',
    );
  });
});

describe('formatFileSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatFileSize(2.25 * 1024 * 1024)).toBe('2.3 MB');
  });
});

describe('putEvidenceFile', () => {
  class FakeXhr {
    static last: FakeXhr;
    withCredentials = false;
    status = 0;
    headers: Record<string, string> = {};
    method = '';
    url = '';
    body: unknown;
    upload: {
      onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
    } = {};
    onload?: () => void;
    onerror?: () => void;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: unknown) {
      this.body = body;
    }
  }

  it('PUTs with the signed headers, no credentials, and reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: number[] = [];
    const file = new Blob(['x']);
    const done = putEvidenceFile('https://s3/u', { 'Content-Type': 'application/pdf' }, file, (p) =>
      progress.push(p),
    );
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('PUT');
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.status = 200;
    xhr.onload?.();
    await expect(done).resolves.toBeUndefined();
    expect(progress).toEqual([50, 100]);
  });

  it('rejects on a storage error or network failure', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const failed = putEvidenceFile('u', {}, new Blob(['x']), () => {});
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(failed).rejects.toThrow();

    const offline = putEvidenceFile('u', {}, new Blob(['x']), () => {});
    FakeXhr.last.onerror?.();
    await expect(offline).rejects.toThrow();
  });
});
