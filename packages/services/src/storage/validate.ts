import {
  ALLOWED_UPLOAD_MIME_PREFIXES,
  formatBytes,
  MAX_UPLOAD_BYTES,
  payloadTooLarge,
  unsupportedMediaType,
  validationFailed,
} from '@orbit/shared';
import { randomUUIDv7 } from 'bun';
import { z } from 'zod';
import type { StorageKind } from './types.ts';

export const uploadCandidateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255).toLowerCase(),
  size: z.number().int().positive(),
});

export type UploadCandidate = z.input<typeof uploadCandidateSchema>;

export interface ValidatedUpload {
  readonly fileName: string;
  readonly safeName: string;
  readonly contentType: string;
  readonly size: number;
  readonly kind: StorageKind;
}

export function kindOf(contentType: string): StorageKind {
  const value = contentType.toLowerCase();
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  if (value === 'application/pdf') return 'pdf';
  if (value.startsWith('text/')) return 'text';
  return 'other';
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).at(-1) ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  if (cleaned.length === 0) return 'file';
  return cleaned.length > 120 ? cleaned.slice(-120).replace(/^[-.]+/, '') : cleaned;
}

export function validateUpload(candidate: UploadCandidate): ValidatedUpload {
  const parsed = uploadCandidateSchema.safeParse(candidate);
  if (!parsed.success) {
    throw validationFailed('That upload request is not valid.', {
      details: { issues: parsed.error.issues },
    });
  }
  const { fileName, contentType, size } = parsed.data;
  if (size > MAX_UPLOAD_BYTES) {
    throw payloadTooLarge(`Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller.`, {
      details: { size, maxBytes: MAX_UPLOAD_BYTES },
    });
  }
  if (!ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
    throw unsupportedMediaType('That file type is not supported.', { details: { contentType } });
  }
  return {
    fileName,
    safeName: sanitizeFileName(fileName),
    contentType,
    size,
    kind: kindOf(contentType),
  };
}

export function storageKeyFor(
  organizationId: string,
  fileName: string,
  at: Date = new Date(),
): string {
  if (organizationId.trim().length === 0) {
    throw validationFailed('An organization is required to store a file.');
  }
  const organization = sanitizeFileName(organizationId);
  const year = String(at.getUTCFullYear());
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${organization}/${year}/${month}/${randomUUIDv7('hex', at)}-${sanitizeFileName(fileName)}`;
}
