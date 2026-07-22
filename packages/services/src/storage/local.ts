import { mkdir, rm, stat as statFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { internal, MAX_UPLOAD_BYTES, validationFailed } from '@orbit/shared';
import type { StorageDriver, StoredObject, UploadTarget } from './types.ts';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
};

export const DEFAULT_LOCAL_DIR = './uploads';
export const LOCAL_FILE_ROUTE = '/api/files';
const UPLOAD_URL_TTL_MS = 3_600_000;

export function assertSafeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, '');
  const escapes =
    key.length === 0 ||
    key.includes('\0') ||
    key.includes('\\') ||
    path.posix.isAbsolute(key) ||
    normalized.length === 0 ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.split('/').includes('..');
  if (escapes) {
    throw validationFailed('That storage key is not allowed.', { details: { key } });
  }
  return normalized;
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string = process.env['STORAGE_LOCAL_DIR'] ?? DEFAULT_LOCAL_DIR) {
    this.root = path.resolve(root);
  }

  resolve(key: string): string {
    const normalized = assertSafeKey(key);
    const target = path.resolve(this.root, normalized);
    const prefix = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!target.startsWith(prefix)) {
      throw validationFailed('That storage key is not allowed.', { details: { key } });
    }
    return target;
  }

  createUploadTarget(key: string, contentType: string, size: number): Promise<UploadTarget> {
    return Promise.resolve().then(() => {
      const safeKey = assertSafeKey(key);
      return {
        key: safeKey,
        url: `${LOCAL_FILE_ROUTE}/${safeKey}`,
        method: 'PUT' as const,
        headers: { 'content-type': contentType, 'content-length': String(size) },
        maxBytes: MAX_UPLOAD_BYTES,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString(),
      };
    });
  }

  async put(key: string, body: Uint8Array, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  getUrl(key: string, _expiresInSeconds: number): Promise<string> {
    return Promise.resolve().then(() => `${LOCAL_FILE_ROUTE}/${assertSafeKey(key)}`);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async stat(key: string): Promise<StoredObject | null> {
    const target = this.resolve(key);
    try {
      const info = await statFile(target);
      if (!info.isFile()) return null;
      return {
        key: assertSafeKey(key),
        size: info.size,
        contentType:
          CONTENT_TYPE_BY_EXTENSION[path.extname(target).toLowerCase()] ??
          'application/octet-stream',
        updatedAt: info.mtime,
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw internal('Could not read that file from local storage.', error);
    }
  }
}

function isMissingFile(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}
