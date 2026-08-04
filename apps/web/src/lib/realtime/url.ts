import { z } from 'zod';

const REALTIME_PATH = '/api/ws';

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

export function resolveRealtimeUrl(configured: string, origin: string): string {
  if (configured.length > 0) return configured;
  if (origin.length === 0) return '';
  const url = new URL(REALTIME_PATH, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
