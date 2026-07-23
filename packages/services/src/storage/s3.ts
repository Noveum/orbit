import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { internal, MAX_UPLOAD_BYTES } from '@orbit/shared';
import { z } from 'zod';
import { assertSafeKey } from './local.ts';
import type { StorageDriver, StoredObject, UploadTarget } from './types.ts';

export const s3ConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1).default('us-east-1'),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(true),
});

export type S3Config = z.input<typeof s3ConfigSchema>;

const UPLOAD_URL_TTL_SECONDS = 900;

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    const parsed = s3ConfigSchema.parse(config);
    this.bucket = parsed.bucket;
    this.client = new S3Client({
      region: parsed.region,
      forcePathStyle: parsed.forcePathStyle,
      credentials: {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      },
      ...(parsed.endpoint === undefined ? {} : { endpoint: parsed.endpoint }),
    });
  }

  async createUploadTarget(key: string, contentType: string, size: number): Promise<UploadTarget> {
    assertSafeKey(key);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(size) },
      maxBytes: MAX_UPLOAD_BYTES,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertSafeKey(key);
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async stat(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size: head.ContentLength ?? 0,
        contentType: head.ContentType ?? 'application/octet-stream',
        updatedAt: head.LastModified ?? new Date(),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw internal('Could not read that file from storage.', error);
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
