import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'crypto' });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EnvelopeEncrypted {
  ciphertext: string;
  encryptedDataKey: string;
  iv: string;
  authTag: string;
  keyId: string;
}

export interface KeyProvider {
  generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }>;
  decryptDataKey(encryptedKey: string): Promise<Buffer>;
}

export class LocalKeyProvider implements KeyProvider {
  private readonly masterKey: Buffer;

  constructor() {
    const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKeyHex) {
      logger.warn('ENCRYPTION_MASTER_KEY not set — using development key');
      this.masterKey = createHash('sha256').update('dev-master-key-do-not-use-in-production').digest();
    } else {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    }
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: string }> {
    const plaintextKey = randomBytes(KEY_LENGTH);
    const encryptedKey = this.encryptWithMasterKey(plaintextKey);
    return { plaintextKey, encryptedKey };
  }

  async decryptDataKey(encryptedKey: string): Promise<Buffer> {
    return this.decryptWithMasterKey(encryptedKey);
  }

  private encryptWithMasterKey(plaintext: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private decryptWithMasterKey(encrypted: string): Buffer {
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

let keyProvider: KeyProvider = new LocalKeyProvider();

export function setKeyProvider(p: KeyProvider): void {
  keyProvider = p;
}

export async function envelopeEncrypt(plaintext: string, keyId = 'local'): Promise<EnvelopeEncrypted> {
  const { plaintextKey, encryptedKey } = await keyProvider.generateDataKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    encryptedDataKey: encryptedKey,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyId,
  };
}

export async function envelopeDecrypt(encrypted: EnvelopeEncrypted): Promise<string> {
  const plaintextKey = await keyProvider.decryptDataKey(encrypted.encryptedDataKey);
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, plaintextKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf-8');
}

export function hashForLookup(value: string): string {
  const salt = process.env.HMAC_SALT ?? 'dev-salt-change-in-production';
  return createHash('sha256').update(salt + value).digest('hex');
}
