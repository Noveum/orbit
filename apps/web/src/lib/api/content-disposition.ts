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

function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function dispositionFor(contentType: string, fileName: string): string {
  const inline = INLINE_CONTENT_TYPES.some((allowed) => allowed === contentType.toLowerCase());
  const type = inline ? 'inline' : 'attachment';
  const asciiName = fileName.replace(/["\\\r\n]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'file';
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${rfc5987Encode(fileName)}`;
}
