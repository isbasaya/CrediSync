import { describe, it, expect, afterEach } from 'vitest';
import {
  decryptFromBytes,
  encryptToBytes,
  envelopeDecrypt,
  envelopeEncrypt,
  hmacLookup,
  KmsKeyProvider,
  LocalKeyProvider,
  safeEqual,
  setKeyProvider,
} from '../index';

afterEach(() => setKeyProvider(null));

describe('envelope encryption', () => {
  it('round-trips a value and never stores the plaintext', async () => {
    const envelope = await envelopeEncrypt('8001015009087');
    expect(JSON.stringify(envelope)).not.toContain('8001015009087');
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
    expect(await envelopeDecrypt(envelope)).toBe('8001015009087');
  });

  it('round-trips through the BYTEA storage form', async () => {
    const bytes = await encryptToBytes('secret-token');
    expect(await decryptFromBytes(bytes)).toBe('secret-token');
  });

  it('detects tampering', async () => {
    const envelope = await envelopeEncrypt('8001015009087');
    const tampered = { ...envelope, ciphertext: Buffer.from('tampered!!!!!').toString('base64') };
    await expect(envelopeDecrypt(tampered)).rejects.toThrow();
  });

  it('uses fresh randomness for every encryption', async () => {
    const a = await envelopeEncrypt('same');
    const b = await envelopeEncrypt('same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('LocalKeyProvider', () => {
  it('refuses to start in production without a master key', () => {
    expect(() => new LocalKeyProvider({ NODE_ENV: 'production' })).toThrow(/ENCRYPTION_MASTER_KEY/);
  });

  it('rejects a master key of the wrong length', () => {
    expect(
      () => new LocalKeyProvider({ NODE_ENV: 'development', ENCRYPTION_MASTER_KEY: 'abcd' }),
    ).toThrow(/32 bytes/);
  });
});

describe('KmsKeyProvider', () => {
  it('enforces af-south-1 data residency', () => {
    expect(() => new KmsKeyProvider('key', 'eu-west-1')).toThrow(/af-south-1/);
    expect(() => new KmsKeyProvider('key', 'af-south-1')).not.toThrow();
  });
});

describe('hmacLookup', () => {
  it('is deterministic for the same key and differs across keys', () => {
    const a = hmacLookup('8001015009087', { NODE_ENV: 'test', HMAC_KEY: 'k'.repeat(40) });
    const b = hmacLookup('8001015009087', { NODE_ENV: 'test', HMAC_KEY: 'k'.repeat(40) });
    const c = hmacLookup('8001015009087', { NODE_ENV: 'test', HMAC_KEY: 'j'.repeat(40) });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('refuses to run in production without a key', () => {
    expect(() => hmacLookup('x', { NODE_ENV: 'production' })).toThrow(/HMAC_KEY/);
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
