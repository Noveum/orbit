import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type stream from 'node:stream';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
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

function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const target = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

function createDecompressor(encoding: string): stream.Transform | null {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

interface DecompressResult {
  readonly stream: stream.Readable;
  readonly decompressed: boolean;
}

function decompressBody(
  res: http.IncomingMessage,
  rawEncoding: string | undefined,
): DecompressResult {
  if (rawEncoding === undefined || rawEncoding.length === 0) {
    return { stream: res, decompressed: false };
  }

  const encodings = rawEncoding
    .toLowerCase()
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  let current: stream.Readable = res;
  let count = 0;
  for (let i = encodings.length - 1; i >= 0; i--) {
    const enc = encodings[i];
    if (enc === undefined) continue;
    const decompressor = createDecompressor(enc);
    if (decompressor === null) {
      break;
    }
    current.on('error', (err) => decompressor.destroy(err));
    current = current.pipe(decompressor);
    count += 1;
  }

  return {
    stream: current,
    decompressed: count > 0,
  };
}

function hookCancellation(
  req: http.ClientRequest,
  res: http.IncomingMessage,
  bodyStream: stream.Readable,
  decompressed: boolean,
): stream.Readable {
  res.on('error', () => undefined);
  req.on('error', () => undefined);

  let closing = false;
  const closeUpstream = () => {
    if (closing) return;
    closing = true;
    if (!res.destroyed) res.destroy();
    if (!req.destroyed) req.destroy();
    res.socket?.destroy();
    req.socket?.destroy();
  };

  if (decompressed) {
    const originalDestroy = bodyStream.destroy.bind(bodyStream);
    bodyStream.destroy = (error?: Error) => {
      closeUpstream();
      return originalDestroy(error);
    };
  }

  bodyStream.on('close', () => {
    if (!res.readableEnded) {
      closeUpstream();
    }
  });

  return bodyStream;
}

function buildWebResponse(
  req: http.ClientRequest,
  res: http.IncomingMessage,
  isHead: boolean,
): Response {
  const statusCode = res.statusCode ?? 200;

  if (isNullBodyStatus(statusCode) || isHead) {
    res.resume();
    return new Response(null, {
      status: statusCode,
      statusText: res.statusMessage ?? '',
      headers: toWebHeaders(res.headers),
    });
  }

  const { stream: rawBodyStream, decompressed } = decompressBody(
    res,
    res.headers['content-encoding'],
  );

  const bodyStream = hookCancellation(req, res, rawBodyStream, decompressed);

  const webHeaders = toWebHeaders(res.headers);
  if (decompressed) {
    webHeaders.delete('content-encoding');
    webHeaders.delete('content-length');
  }

  const webStream = Readable.toWeb(bodyStream) as unknown as BodyInit;
  return new Response(webStream, {
    status: statusCode,
    statusText: res.statusMessage ?? '',
    headers: webHeaders,
  });
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

  const reqHeaders: Record<string, string> = { ...options.headers };
  if (!hasHeader(options.headers, 'accept-encoding')) {
    reqHeaders['accept-encoding'] = 'gzip, deflate, br';
  }

  const reqOptions: https.RequestOptions = {
    protocol: parsed.protocol,
    hostname: cleanHost,
    port: defaultPortForProtocol(parsed.protocol, parsed.port),
    path: parsed.pathname + parsed.search,
    method: options.method ?? 'GET',
    headers: reqHeaders,
    lookup,
    servername: cleanHost,
  };

  return await new Promise<Response>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Request aborted before start'));
      return;
    }

    const req = client.request(reqOptions, (res) => {
      try {
        const isHead = (options.method ?? 'GET').toUpperCase() === 'HEAD';
        resolve(buildWebResponse(req, res, isHead));
      } catch (err) {
        res.resume();
        reject(err);
      }
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
