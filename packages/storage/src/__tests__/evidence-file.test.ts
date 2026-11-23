import { describe, it, expect, afterEach } from 'vitest';
import {
  sniffEvidenceType,
  sanitizeDisplayName,
  verifyEvidenceObject,
  createEvidenceDownloadUrl,
  deleteEvidenceObject,
  InMemoryStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
  setStorageProvider,
  MAX_EVIDENCE_BYTES,
} from '../index';

afterEach(() => setStorageProvider(null));

describe('evidence file primitives', () => {
  it('identifies real files by signature', () => {
    expect(sniffEvidenceType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffEvidenceType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffEvidenceType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(sniffEvidenceType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('sanitises hostile filenames', () => {
    expect(sanitizeDisplayName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeDisplayName('C:\\x\\proof.pdf')).toBe('proof.pdf');
    expect(sanitizeDisplayName('a"\r\nb<script>.pdf')).toBe('ab script .pdf');
    expect(sanitizeDisplayName('x'.repeat(500) + '.pdf')).toHaveLength(120);
    expect(sanitizeDisplayName('x'.repeat(500) + '.pdf').endsWith('.pdf')).toBe(true);
    expect(sanitizeDisplayName('   ')).toBe('evidence');
  });

  it('rejects a missing, oversized or spoofed object', async () => {
    const p = new InMemoryStorageProvider();
    setStorageProvider(p);
    expect(await verifyEvidenceObject('none', 'application/pdf')).toEqual({
      ok: false,
      reason: 'missing',
    });
    p.put(
      'big',
      Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(MAX_EVIDENCE_BYTES)]),
      'application/pdf',
    );
    expect(await verifyEvidenceObject('big', 'application/pdf')).toEqual({
      ok: false,
      reason: 'too_large',
    });
    p.put('exe', Buffer.from('MZ\x90\x00'), 'application/pdf');
    expect(await verifyEvidenceObject('exe', 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    p.put('ok', Buffer.from('%PDF-1.7 body'), 'application/pdf');
    expect(await verifyEvidenceObject('ok', 'application/pdf')).toEqual({ ok: true, size: 13 });
    p.put('png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
    expect(await verifyEvidenceObject('png', 'application/pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('deletes objects and reports delete failures', async () => {
    const p = new InMemoryStorageProvider();
    setStorageProvider(p);
    p.put('k', Buffer.from('%PDF-1'), 'application/pdf');
    await deleteEvidenceObject('k');
    expect(p.has('k')).toBe(false);
    p.put('k2', Buffer.from('%PDF-1'), 'application/pdf');
    p.failDeletes = true;
    await expect(deleteEvidenceObject('k2')).rejects.toThrow();
    expect(p.has('k2')).toBe(true);
  });

  it('builds a download url carrying the file name', async () => {
    setStorageProvider(new InMemoryStorageProvider());
    const url = await createEvidenceDownloadUrl('k', 'proof.pdf');
    expect(url).toContain('proof.pdf');
  });

  it('local provider reports no object and no bytes', async () => {
    const p = new LocalStorageProvider();
    expect(await p.headObject('k')).toBeNull();
    expect((await p.readObjectStart('k', 8)).length).toBe(0);
  });

  it('S3 provider enforces af-south-1', () => {
    expect(() => new S3StorageProvider('b', 'k', 'eu-west-1')).toThrow(/af-south-1/);
  });
});
