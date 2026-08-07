export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const MAX_INLINE_UPLOAD_BYTES = 4 * 1024 * 1024;

export function base64LengthFor(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_DIMENSION = 512;
export const AVATAR_CONTENT_TYPE = 'image/jpeg';

export const ALLOWED_UPLOAD_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'text/',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument',
  'application/msword',
  'application/vnd.ms-excel',
] as const;
