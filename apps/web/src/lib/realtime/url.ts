import { z } from 'zod';

const REALTIME_PATH = '/api/ws';

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '[::1]', '::1'];

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

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

function loopbackAddress(hostname: string): boolean {
  const octets = IPV4_LOOPBACK.exec(hostname);
  if (octets === null) return false;
  return octets.slice(1).every((octet) => Number(octet) <= 255);
}

function servedLocally(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return LOCAL_HOSTNAMES.includes(hostname) || loopbackAddress(hostname);
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
