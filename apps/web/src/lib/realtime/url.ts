import { z } from 'zod';

const REALTIME_PATH = '/api/ws';

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1'];

const socketUrlSchema = z
  .url()
  .refine((value) => value.startsWith('ws://') || value.startsWith('wss://'))
  .catch('');

export function configuredRealtimeUrl(): string {
  if (process.env['NODE_ENV'] === 'production') return '';
  const configured = process.env['NEXT_PUBLIC_REALTIME_URL'] ?? '';
  if (configured.length === 0) return '';
  return socketUrlSchema.parse(configured);
}

function servedLocally(origin: string): boolean {
  try {
    return LOCAL_HOSTNAMES.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function resolveRealtimeUrl(configured: string, origin: string): string {
  if (origin.length === 0) return '';
  if (configured.length > 0 && servedLocally(origin)) return configured;
  const url = new URL(REALTIME_PATH, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
