const INLINE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
] as const;

export function dispositionFor(contentType: string, fileName: string): string {
  const inline = INLINE_CONTENT_TYPES.some((allowed) => allowed === contentType.toLowerCase());
  const safeName = fileName.replace(/["\\\r\n]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;
}
