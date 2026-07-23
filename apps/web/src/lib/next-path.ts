export function safeNextPath(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > 2048) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  return value;
}
