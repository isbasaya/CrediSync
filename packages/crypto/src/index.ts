import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { requireSecret } from '@credisync/config';

/**
 * Envelope encryption for personal information at rest (SA ID numbers,
 * open-banking access tokens).
 *
 *   plaintext --AES-256-GCM(data key)--> ciphertext
 *   data key  --KMS (or local master key in development)--> encryptedDataKey
 *
 * Production uses AWS KMS in af-south-1 (set KMS_KEY_ID); the local provider
 * exists for development and tests and refuses to run elsewhere without an
 * explicit ENCRYPTION_MASTER_KEY.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENVELOPE_VERSION = 1;

export interface EnvelopeEncrypted {
  v: number;
  ciphertext: string;
  encryptedDataKey: string;
  iv: string;
  authTag: string;
  keyId: string;
}

export interface KeyProvider {
  readonly keyId: string;
  generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }>;
  decryptDataKey(encryptedKey: string): Promise<Buffer>;
}

const DEV_MASTER_KEY_HEX = createHash('sha256').update('credisync-dev-master-key-do-not-use').digest('hex');

export class LocalKeyProvider implements KeyProvider {
  readonly keyId = 'local';
  private readonly masterKey: Buffer;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const hex = requireSecret('ENCRYPTION_MASTER_KEY', { devFallback: DEV_MASTER_KEY_HEX, minLength: 64 }, env);
    const key = Buffer.from(hex, 'hex');
    if (key.length !== KEY_LENGTH) {
      throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes encoded as 64 hex characters');
    }
    this.masterKey = key;
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    const plaintextKey = randomBytes(KEY_LENGTH);
    return { plaintextKey, encryptedKey: this.wrap(plaintextKey) };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    const data = Buffer.from(encryptedKey, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private wrap(plaintext: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
}

/** AWS KMS provider. The KMS client is loaded lazily so development never needs AWS credentials. */
export class KmsKeyProvider implements KeyProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientPromise: Promise<any> | null = null;

  constructor(
    readonly keyId: string,
    private readonly region: string = process.env.AWS_REGION ?? 'af-south-1'
  ) {
    if (this.region !== 'af-south-1') {
      throw new Error(`KMS region must be af-south-1 (data residency); got ${this.region}`);
    }
  }

  private async kms() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-kms').then((m) => ({ m, client: new m.KMSClient({ region: this.region }) }));
    }
    return this.clientPromise;
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    const { m, client } = await this.kms();
    const out = await client.send(new m.GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256' }));
    if (!out.Plaintext || !out.CiphertextBlob) throw new Error('KMS GenerateDataKey returned no key material');
    return { plaintextKey: Buffer.from(out.Plaintext), encryptedKey: Buffer.from(out.CiphertextBlob).toString('base64') };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    const { m, client } = await this.kms();
    const out = await client.send(
      new m.DecryptCommand({ KeyId: this.keyId, CiphertextBlob: Buffer.from(encryptedKey, 'base64') })
    );
    if (!out.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
    return Buffer.from(out.Plaintext);
  }
}

let keyProvider: KeyProvider | null = null;

function defaultProvider(): KeyProvider {
  const kmsKeyId = process.env.KMS_KEY_ID;
  return kmsKeyId ? new KmsKeyProvider(kmsKeyId) : new LocalKeyProvider();
}

function provider(): KeyProvider {
  if (!keyProvider) keyProvider = defaultProvider();
  return keyProvider;
}

export function setKeyProvider(p: KeyProvider | null): void {
  keyProvider = p;
}

export async function envelopeEncrypt(plaintext: string): Promise<EnvelopeEncrypted> {
  const kp = provider();
  const { plaintextKey, encryptedKey } = await kp.generateDataKey();
  try {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    return {
      v: ENVELOPE_VERSION,
      ciphertext: ciphertext.toString('base64'),
      encryptedDataKey: encryptedKey,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyId: kp.keyId,
    };
  } finally {
    plaintextKey.fill(0);
  }
}

export async function envelopeDecrypt(encrypted: EnvelopeEncrypted): Promise<string> {
  const plaintextKey = await provider().decryptDataKey(encrypted.encryptedDataKey);
  try {
    const decipher = createDecipheriv(ALGORITHM, plaintextKey, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
    return plaintext.toString('utf-8');
  } finally {
    plaintextKey.fill(0);
  }
}

/** Encrypts a value into the BYTEA form stored in the database. */
export async function encryptToBytes(plaintext: string): Promise<Buffer> {
  return Buffer.from(JSON.stringify(await envelopeEncrypt(plaintext)), 'utf-8');
}

/** Decrypts a BYTEA column value produced by encryptToBytes. */
export async function decryptFromBytes(stored: Buffer | Uint8Array): Promise<string> {
  const envelope = JSON.parse(Buffer.from(stored).toString('utf-8')) as EnvelopeEncrypted;
  return envelopeDecrypt(envelope);
}

const DEV_HMAC_KEY = 'credisync-dev-hmac-key-do-not-use-outside-development';

/** Keyed HMAC-SHA256 for indexed lookup of sensitive identifiers without decryption. */
export function hmacLookup(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = requireSecret('HMAC_KEY', { devFallback: DEV_HMAC_KEY }, env);
  return createHmac('sha256', key).update(value.trim()).digest('hex');
}

/** @deprecated use hmacLookup */
export const hashForLookup = hmacLookup;

/** SHA-256 for high-entropy opaque tokens (refresh tokens, verification links). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
