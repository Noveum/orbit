import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
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
export const UPLOAD_COMPLETION_GRACE_SECONDS = UPLOAD_URL_TTL_SECONDS;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const MAX_DELETE_OBJECTS = 1000;

interface ListedObject {
  readonly key: string;
  readonly size: number;
}

interface ListedVersion {
  readonly Key: string;
  readonly VersionId: string;
}

interface DeletionTarget {
  readonly Key: string;
  readonly VersionId?: string;
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

function listedVersions(
  entries: readonly {
    readonly Key?: string | undefined;
    readonly VersionId?: string | undefined;
  }[],
  prefix: string,
): ListedVersion[] {
  return entries.map((entry) => {
    const key = entry.Key;
    const versionId = entry.VersionId;
    if (
      key === undefined ||
      !key.startsWith(prefix) ||
      versionId === undefined ||
      versionId.length === 0
    ) {
      throw internal('Object storage returned an invalid workspace file-version listing.');
    }
    return { Key: key, VersionId: versionId };
  });
}

function versionListingUnavailable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as {
    readonly name?: unknown;
    readonly Code?: unknown;
    readonly $metadata?: { readonly httpStatusCode?: unknown };
  };
  return (
    candidate.$metadata?.httpStatusCode === 501 ||
    candidate.name === 'NotImplemented' ||
    candidate.name === 'NotSupported' ||
    candidate.Code === 'NotImplemented' ||
    candidate.Code === 'NotSupported'
  );
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

interface PrefixInventory {
  readonly objects: number;
  readonly bytes: number;
}

async function currentPrefixInventory(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<PrefixInventory> {
  let continuationToken: string | undefined;
  let objects = 0;
  let bytes = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: MAX_DELETE_OBJECTS,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      }),
    );
    const listed = listedObjects(page.Contents ?? [], prefix);
    objects += listed.length;
    bytes += listed.reduce((total, entry) => total + entry.size, 0);
    if (!(Number.isSafeInteger(objects) && Number.isSafeInteger(bytes))) {
      throw internal('The workspace file inventory is too large to summarize safely.');
    }
    if (page.IsTruncated !== true) return { objects, bytes };
    if (page.NextContinuationToken === undefined || page.NextContinuationToken.length === 0) {
      throw internal('Object storage returned an incomplete workspace file listing.');
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken !== undefined);
  return { objects, bytes };
}

async function versionPage(
  client: S3Client,
  bucket: string,
  prefix: string,
  keyMarker?: string,
  versionIdMarker?: string,
): Promise<ListObjectVersionsCommandOutput | null> {
  try {
    return await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: MAX_DELETE_OBJECTS,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionIdMarker === undefined ? {} : { VersionIdMarker: versionIdMarker }),
      }),
    );
  } catch (error: unknown) {
    if (versionListingUnavailable(error)) return null;
    throw error;
  }
}

function totalVersionBytes(entries: readonly { readonly Size?: number | undefined }[]): number {
  return entries.reduce((total, entry) => {
    const size = entry.Size ?? 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw internal('Object storage returned an invalid workspace file-version listing.');
    }
    return total + size;
  }, 0);
}

async function versionPrefixInventory(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<PrefixInventory | null> {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  let objects = 0;
  let bytes = 0;
  do {
    const page = await versionPage(client, bucket, prefix, keyMarker, versionIdMarker);
    if (page === null) return null;
    const entries = page.Versions ?? [];
    objects += listedVersions(entries, prefix).length;
    bytes += totalVersionBytes(entries);
    listedVersions(page.DeleteMarkers ?? [], prefix);
    if (!(Number.isSafeInteger(objects) && Number.isSafeInteger(bytes))) {
      throw internal('The workspace file-version inventory is too large to summarize safely.');
    }
    if (page.IsTruncated !== true) return { objects, bytes };
    if (
      page.NextKeyMarker === undefined ||
      page.NextKeyMarker.length === 0 ||
      page.NextVersionIdMarker === undefined ||
      page.NextVersionIdMarker.length === 0
    ) {
      throw internal('Object storage returned an incomplete workspace file-version listing.');
    }
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
  } while (keyMarker !== undefined);
  return { objects, bytes };
}

async function deleteObjects(
  client: S3Client,
  bucket: string,
  objects: readonly DeletionTarget[],
  failureMessage: string,
): Promise<void> {
  for (let offset = 0; offset < objects.length; offset += MAX_DELETE_OBJECTS) {
    const batch = objects.slice(offset, offset + MAX_DELETE_OBJECTS);
    const deleted = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }),
    );
    if ((deleted.Errors?.length ?? 0) > 0) throw internal(failureMessage);
  }
}

async function deleteCurrentObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  while (true) {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: MAX_DELETE_OBJECTS }),
    );
    const listed = listedObjects(page.Contents ?? [], prefix);
    if (listed.length > 0) {
      await deleteObjects(
        client,
        bucket,
        listed.map((entry) => ({ Key: entry.key })),
        'Object storage could not delete every workspace file.',
      );
      continue;
    }
    if (page.IsTruncated === true) {
      throw internal('Object storage returned an incomplete workspace file listing.');
    }
    return;
  }
}

async function deleteVersionedObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  while (true) {
    const page = await versionPage(client, bucket, prefix);
    if (page === null) return;
    const versions = [
      ...listedVersions(page.Versions ?? [], prefix),
      ...listedVersions(page.DeleteMarkers ?? [], prefix),
    ];
    if (versions.length > 0) {
      await deleteObjects(
        client,
        bucket,
        versions,
        'Object storage could not delete every workspace file version.',
      );
      continue;
    }
    if (page.IsTruncated === true) {
      throw internal('Object storage returned an incomplete workspace file-version listing.');
    }
    return;
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
    try {
      const current = await currentPrefixInventory(client, this.bucket, safePrefix);
      const versions = await versionPrefixInventory(client, this.bucket, safePrefix);
      return {
        objects: current.objects,
        bytes: current.bytes,
        versions: versions?.objects ?? current.objects,
        versionBytes: versions?.bytes ?? current.bytes,
      };
    } catch (error: unknown) {
      throwStorageError('Could not inspect workspace files in storage.', error);
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const safePrefix = assertSafePrefix(prefix);
    const client = await this.client();
    try {
      await deleteCurrentObjects(client, this.bucket, safePrefix);
      await deleteVersionedObjects(client, this.bucket, safePrefix);
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
