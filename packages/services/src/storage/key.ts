import path from 'node:path';
import { validationFailed } from '@orbit/shared';

export const FILE_ROUTE = '/api/files';

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
