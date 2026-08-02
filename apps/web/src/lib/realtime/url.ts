const REALTIME_PATH = '/api/ws';

export function configuredRealtimeUrl(): string {
  return process.env['NEXT_PUBLIC_REALTIME_URL'] ?? '';
}

export function resolveRealtimeUrl(configured: string, origin: string): string {
  if (configured.length > 0) return configured;
  if (origin.length === 0) return '';
  const url = new URL(REALTIME_PATH, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
