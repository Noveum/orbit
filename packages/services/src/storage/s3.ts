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
import { createCredentialResolver, type ResolvedCredentials } from './credentials.ts';
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
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly bucket: string;
  private readonly base: {
    region: string;
    forcePathStyle: boolean;
    endpoint?: string;
  };
  private readonly resolveCredentials: () => Promise<ResolvedCredentials | undefined>;
  private cached: { key: string; client: S3Client } | null = null;

  constructor(config: S3Config) {
    const parsed = s3ConfigSchema.parse(config);
    const { accessKeyId, secretAccessKey, sessionToken, endpoint } = parsed;
    this.bucket = parsed.bucket;
    this.base = {
      region: parsed.region,
      forcePathStyle: parsed.forcePathStyle ?? endpoint !== undefined,
      ...(endpoint === undefined ? {} : { endpoint }),
    };
    this.resolveCredentials = createCredentialResolver(parsed.region, {
      ...(accessKeyId === undefined ? {} : { accessKeyId }),
      ...(secretAccessKey === undefined ? {} : { secretAccessKey }),
      ...(sessionToken === undefined ? {} : { sessionToken }),
    });
  }

  private async client(): Promise<S3Client> {
    const credentials = await this.resolveCredentials();
    const key =
      credentials === undefined
        ? 'ambient'
        : `${credentials.accessKeyId}:${credentials.sessionToken ?? ''}`;
    if (this.cached !== null && this.cached.key === key) return this.cached.client;

    const client = new S3Client({
      ...this.base,
      ...(credentials === undefined
        ? {}
        : {
            credentials: {
              accessKeyId: credentials.accessKeyId,
              secretAccessKey: credentials.secretAccessKey,
              ...(credentials.sessionToken === undefined
                ? {}
                : { sessionToken: credentials.sessionToken }),
            },
          }),
    });
    this.cached = { key, client };
    return client;
  }

  async createUploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    assertSafeKey(key);
    const client = await this.client();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'content-type': contentType },
      maxBytes: MAX_UPLOAD_BYTES,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getUrl(
    key: string,
    expiresInSeconds: number,
    options: DownloadOptions = {},
  ): Promise<string> {
    assertSafeKey(key);
    const client = await this.client();
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.contentType === undefined ? {} : { ResponseContentType: options.contentType }),
        ...(options.disposition === undefined
          ? {}
          : { ResponseContentDisposition: options.disposition }),
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async stat(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    try {
      const client = await this.client();
      const stats = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const contentType = stats.ContentType ?? '';
      return {
        key,
        size: stats.ContentLength ?? 0,
        contentType: contentType.length === 0 ? DEFAULT_CONTENT_TYPE : contentType,
        updatedAt: stats.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw internal('Could not read that file from storage.', error);
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.Code === 'NoSuchKey' ||
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
