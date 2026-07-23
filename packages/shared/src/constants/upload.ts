export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
