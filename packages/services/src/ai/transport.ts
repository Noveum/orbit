import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isPrivateOrLoopbackHost } from '@orbit/shared/validators';

export type DnsLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family: number,
) => void;

export type DnsLookupFn = (
  hostname: string,
  options: dns.LookupOptions,
  callback: DnsLookupCallback,
) => void;

function assertAddressesAllowed(
  address: string | readonly dns.LookupAddress[],
  family?: number,
): Error | null {
  const entries = Array.isArray(address)
    ? address
    : [{ address: address as string, family: family ?? 0 }];

  for (const entry of entries) {
    const addr = typeof entry === 'string' ? entry : entry.address;
    if (isPrivateOrLoopbackHost(addr)) {
      return new Error(`Blocked connection to private address: ${addr}`);
    }
  }
  return null;
}

export function createSafeLookup(
  allowPrivate = false,
  dnsLookup: DnsLookupFn = dns.lookup,
): https.RequestOptions['lookup'] {
  return (hostname, options, callback) => {
    if (!allowPrivate && isPrivateOrLoopbackHost(hostname)) {
      callback(new Error(`Blocked connection to private destination: ${hostname}`), '', 0);
      return;
    }

    dnsLookup(hostname, options, (err, address, family) => {
      if (err) {
        callback(err, address, family);
        return;
      }

      if (!allowPrivate) {
        const violation = assertAddressesAllowed(address, family);
        if (violation !== null) {
          callback(violation, '', 0);
          return;
        }
      }

      callback(null, address, family);
    });
  };
}

export interface SafeFetchOptions {
  readonly method?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly body?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly allowPrivate?: boolean | undefined;
  readonly dnsLookup?: DnsLookupFn | undefined;
  readonly fetchFn?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
}

function defaultPortForProtocol(protocol: string, portStr: string): number {
  if (portStr.length > 0) return Number.parseInt(portStr, 10);
  return protocol === 'https:' ? 443 : 80;
}

function toWebHeaders(nodeHeaders: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const parsed = new URL(url);
  const allowPrivate = options.allowPrivate ?? process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] === 'true';

  if (!allowPrivate && isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error(`Blocked connection to private destination: ${parsed.hostname}`);
  }

  if (options.fetchFn !== undefined) {
    const init: RequestInit = { redirect: 'manual' };
    if (options.method !== undefined) init.method = options.method;
    if (options.headers !== undefined) init.headers = options.headers;
    if (options.body !== undefined) init.body = options.body;
    if (options.signal !== undefined) init.signal = options.signal;
    return await options.fetchFn(url, init);
  }

  const cleanHost =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  const lookup = createSafeLookup(allowPrivate, options.dnsLookup);
  const client = parsed.protocol === 'https:' ? https : http;

  const reqOptions: https.RequestOptions = {
    protocol: parsed.protocol,
    hostname: cleanHost,
    port: defaultPortForProtocol(parsed.protocol, parsed.port),
    path: parsed.pathname + parsed.search,
    method: options.method ?? 'GET',
    headers: options.headers,
    lookup,
    servername: cleanHost,
  };

  return await new Promise<Response>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Request aborted before start'));
      return;
    }

    const req = client.request(reqOptions, (res) => {
      const webStream = Readable.toWeb(res) as unknown as BodyInit;
      resolve(
        new Response(webStream, {
          status: res.statusCode ?? 200,
          statusText: res.statusMessage ?? '',
          headers: toWebHeaders(res.headers),
        }),
      );
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.signal) {
      const onAbort = () => {
        req.destroy(new Error('Request aborted'));
        reject(new Error('Request aborted'));
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => {
        options.signal?.removeEventListener('abort', onAbort);
      });
    }

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
