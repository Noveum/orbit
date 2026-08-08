import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  formatBytes,
  internal,
  isDomainError,
  MAX_UPLOAD_BYTES,
  payloadTooLarge,
  validationFailed,
} from '@orbit/shared';
import { z } from 'zod';
import { createCredentialResolver, type ResolvedCredentials } from './credentials.ts';
import { assertSafeKey, assertSafePrefix } from './key.ts';
import type {
  DownloadOptions,
  StorageDriver,
  StoragePrefixSummary,
  StoredObject,
  UploadTarget,
} from './types.ts';

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

export const UPLOAD_URL_TTL_SECONDS = 900;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const MAX_DELETE_OBJECTS = 1000;

interface ListedObject {
  readonly key: string;
  readonly size: number;
}

function listedObjects(
  contents: readonly {
    readonly Key?: string | undefined;
    readonly Size?: number | undefined;
  }[],
  prefix: string,
): ListedObject[] {
  return contents.map((entry) => {
    const key = entry.Key;
    const size = entry.Size ?? 0;
    if (key === undefined || !key.startsWith(prefix) || !Number.isSafeInteger(size) || size < 0) {
      throw internal('Object storage returned an invalid workspace file listing.');
    }
    return { key, size };
  });
}

function throwStorageError(message: string, error: unknown): never {
  if (isDomainError(error)) throw error;
  throw internal(message, error);
}

function assertSignableLength(contentLength: number): void {
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw validationFailed('An upload has to declare how many bytes it carries.');
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw payloadTooLarge(`Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller.`, {
      details: { size: contentLength, maxBytes: MAX_UPLOAD_BYTES },
    });
  }
}

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly bucket: string;
  private readonly base: {
    region: string;
    forcePathStyle: boolean;
    endpoint?: string;
  };
  private readonly resolveCredentials: () => Promise<ResolvedCredentials | undefined>;
  private readonly providedClient: S3Client | null;
  private cached: { key: string; client: S3Client } | null = null;

  constructor(config: S3Config, providedClient: S3Client | null = null) {
    const parsed = s3ConfigSchema.parse(config);
    const { accessKeyId, secretAccessKey, sessionToken, endpoint } = parsed;
    this.bucket = parsed.bucket;
    this.providedClient = providedClient;
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
    if (this.providedClient !== null) return this.providedClient;
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

  async createUploadTarget(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<UploadTarget> {
    assertSafeKey(key);
    assertSignableLength(contentLength);
    const client = await this.client();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length']) },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'content-type': contentType },
      maxBytes: contentLength,
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

  async summarizePrefix(prefix: string): Promise<StoragePrefixSummary> {
    const safePrefix = assertSafePrefix(prefix);
    const client = await this.client();
    let continuationToken: string | undefined;
    let objects = 0;
    let bytes = 0;
    try {
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: safePrefix,
            MaxKeys: MAX_DELETE_OBJECTS,
            ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
          }),
        );
        const listed = listedObjects(page.Contents ?? [], safePrefix);
        objects += listed.length;
        bytes += listed.reduce((total, entry) => total + entry.size, 0);
        if (!(Number.isSafeInteger(objects) && Number.isSafeInteger(bytes))) {
          throw internal('The workspace file inventory is too large to summarize safely.');
        }
        if (page.IsTruncated !== true) {
          continuationToken = undefined;
          continue;
        }
        if (page.NextContinuationToken === undefined) {
          throw internal('Object storage returned an incomplete workspace file listing.');
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken !== undefined);
      return { objects, bytes };
    } catch (error: unknown) {
      throwStorageError('Could not inspect workspace files in storage.', error);
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const safePrefix = assertSafePrefix(prefix);
    const client = await this.client();
    try {
      while (true) {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: safePrefix,
            MaxKeys: MAX_DELETE_OBJECTS,
          }),
        );
        const listed = listedObjects(page.Contents ?? [], safePrefix);
        if (listed.length === 0) {
          if (page.IsTruncated === true) {
            throw internal('Object storage returned an incomplete workspace file listing.');
          }
          return;
        }
        for (let offset = 0; offset < listed.length; offset += MAX_DELETE_OBJECTS) {
          const batch = listed.slice(offset, offset + MAX_DELETE_OBJECTS);
          const deleted = await client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: batch.map((entry) => ({ Key: entry.key })),
                Quiet: true,
              },
            }),
          );
          if ((deleted.Errors?.length ?? 0) > 0) {
            throw internal('Object storage could not delete every workspace file.');
          }
        }
      }
    } catch (error: unknown) {
      throwStorageError('Could not delete workspace files from storage.', error);
    }
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
