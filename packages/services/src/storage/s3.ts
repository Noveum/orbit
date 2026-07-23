import { internal, MAX_UPLOAD_BYTES } from '@orbit/shared';
import { S3Client } from 'bun';
import { z } from 'zod';
import { assertSafeKey } from './key.ts';
import type { DownloadOptions, StorageDriver, StoredObject, UploadTarget } from './types.ts';

export const s3ConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1).default('us-east-1'),
  endpoint: z.string().url().optional(),
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  sessionToken: z.string().min(1).optional(),
  forcePathStyle: z.boolean().optional(),
});

export type S3Config = z.input<typeof s3ConfigSchema>;

const UPLOAD_URL_TTL_SECONDS = 900;
const CREDENTIAL_PROBE_KEY = 'orbit-credential-probe';
const SESSION_TOKEN_PARAM = 'X-Amz-Security-Token';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(config: S3Config) {
    const parsed = s3ConfigSchema.parse(config);
    const { accessKeyId, secretAccessKey, sessionToken, endpoint } = parsed;
    this.client = new S3Client({
      bucket: parsed.bucket,
      region: parsed.region,
      virtualHostedStyle: !(parsed.forcePathStyle ?? endpoint !== undefined),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(accessKeyId === undefined ? {} : { accessKeyId }),
      ...(secretAccessKey === undefined ? {} : { secretAccessKey }),
      ...(sessionToken === undefined ? {} : { sessionToken }),
    });
    if (accessKeyId !== undefined && secretAccessKey !== undefined && sessionToken === undefined) {
      assertConfiguredCredentialsAreUsed(this.client);
    }
  }

  createUploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    assertSafeKey(key);
    const url = this.client.presign(key, {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      method: 'PUT',
      type: contentType,
    });
    return Promise.resolve({
      key,
      url,
      method: 'PUT',
      headers: { 'content-type': contentType },
      maxBytes: MAX_UPLOAD_BYTES,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.write(key, body, { type: contentType });
  }

  getUrl(key: string, expiresInSeconds: number, options: DownloadOptions = {}): Promise<string> {
    assertSafeKey(key);
    return Promise.resolve(
      this.client.presign(key, {
        expiresIn: expiresInSeconds,
        method: 'GET',
        ...(options.contentType === undefined ? {} : { type: options.contentType }),
        ...(options.disposition === undefined ? {} : { contentDisposition: options.disposition }),
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.delete(key);
  }

  async stat(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    try {
      const stats = await this.client.stat(key);
      return {
        key,
        size: stats.size,
        contentType: stats.type.length === 0 ? DEFAULT_CONTENT_TYPE : stats.type,
        updatedAt: stats.lastModified,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw internal('Could not read that file from storage.', error);
    }
  }
}

function assertConfiguredCredentialsAreUsed(client: S3Client): void {
  const probe = client.presign(CREDENTIAL_PROBE_KEY, { expiresIn: 60, method: 'GET' });
  if (!new URL(probe).searchParams.has(SESSION_TOKEN_PARAM)) return;
  throw internal(
    'Object storage has explicit keys, but the runtime is signing with an ambient AWS session token. Start the process with AWS_SESSION_TOKEN unset, or with S3_SESSION_TOKEN empty, so the configured keys are the only credentials.',
  );
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.code === 'NoSuchKey' ||
    candidate.code === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound'
  );
}
