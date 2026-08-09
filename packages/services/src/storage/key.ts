import path from 'node:path';
import { validationFailed } from '@orbit/shared';

export const FILE_ROUTE = '/api/files';

export function fileUrlFor(key: string): string {
  return `${FILE_ROUTE}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

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

export function assertSafePrefix(prefix: string): string {
  if (!prefix.endsWith('/') || prefix.length < 2) {
    throw validationFailed('That storage prefix is not allowed.', { details: { prefix } });
  }
  const marker = `${prefix}sentinel`;
  if (assertSafeKey(marker) !== marker) {
    throw validationFailed('That storage prefix is not allowed.', { details: { prefix } });
  }
  return prefix;
}

export function storagePrefixFor(organizationId: string): string {
  const valid = /^[A-Za-z0-9_-]+$/.test(organizationId);
  if (!valid) {
    throw validationFailed('That organization cannot own stored files.', {
      details: { organizationId },
    });
  }
  return assertSafePrefix(`${organizationId}/`);
}
