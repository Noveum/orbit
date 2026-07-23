let cached: string | null = null;

export function clientId(): string {
  if (cached === null) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    cached = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return cached;
}
