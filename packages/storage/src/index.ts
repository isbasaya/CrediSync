import { randomUUID } from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'storage' });

export interface PresignedUrl {
  uploadUrl: string;
  downloadUrl: string;
  key: string;
  expiresIn: number;
}

export interface StorageProvider {
  generatePresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<PresignedUrl>;
  generatePresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.STORAGE_BASE_URL ?? 'http://localhost:9000';
  }

  async generatePresignedUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<PresignedUrl> {
    logger.info({ key, contentType, expiresIn }, 'generating local presigned URL');
    return {
      uploadUrl: `${this.baseUrl}/upload/${key}`,
      downloadUrl: `${this.baseUrl}/download/${key}`,
      key,
      expiresIn,
    };
  }

  async generatePresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return `${this.baseUrl}/download/${key}?expires=${expiresIn}`;
  }

  async deleteObject(key: string): Promise<void> {
    logger.info({ key }, 'deleting object (local)');
  }
}

let provider: StorageProvider = new LocalStorageProvider();

export function setStorageProvider(p: StorageProvider): void {
  provider = p;
}

export async function generatePresignedUploadUrl(
  userId: string,
  filename: string,
  contentType: string
): Promise<PresignedUrl> {
  const ext = filename.split('.').pop() ?? '';
  const key = `uploads/${userId}/${randomUUID()}.${ext}`;
  return provider.generatePresignedUploadUrl(key, contentType);
}

export async function generatePresignedDownloadUrl(key: string): Promise<string> {
  return provider.generatePresignedDownloadUrl(key);
}

export async function deleteObject(key: string): Promise<void> {
  return provider.deleteObject(key);
}
