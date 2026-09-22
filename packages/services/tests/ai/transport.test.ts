import { afterEach, describe, expect, it } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import type { DnsLookupCallback, DnsLookupFn } from '../../src/ai/transport.ts';
import { safeFetch } from '../../src/ai/transport.ts';

const originalAllowPrivate = process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

function mockDns(address: string, family = 4): DnsLookupFn {
  return (_hostname, _options, callback: DnsLookupCallback) => {
    callback(null, [{ address, family }], family);
  };
}

function rebindingDns(firstAddress: string, secondAddress: string): DnsLookupFn {
  let calls = 0;
  return (_hostname, _options, callback: DnsLookupCallback) => {
    calls += 1;
    const address = calls === 1 ? firstAddress : secondAddress;
    callback(null, [{ address, family: 4 }], 4);
  };
}

describe('safeFetch connection establishment destination validation', () => {
  afterEach(() => {
    if (originalAllowPrivate === undefined) {
      delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];
    } else {
      process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = originalAllowPrivate;
    }
  });

  it('blocks connection to loopback IPv4 address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('127.0.0.1'),
      }),
    ).rejects.toThrow('Blocked connection to private address: 127.0.0.1');
  });

  it('blocks connection to loopback IPv6 address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('::1', 6),
      }),
    ).rejects.toThrow('Blocked connection to private address: ::1');
  });

  it('blocks connection to IPv4-mapped loopback address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('::ffff:127.0.0.1', 6),
      }),
    ).rejects.toThrow('Blocked connection to private address: ::ffff:127.0.0.1');
  });

  it('blocks connection to link-local cloud metadata address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('169.254.169.254'),
      }),
    ).rejects.toThrow('Blocked connection to private address: 169.254.169.254');
  });

  it('blocks connection to RFC 1918 private IPv4 addresses', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('10.0.0.1'),
      }),
    ).rejects.toThrow('Blocked connection to private address: 10.0.0.1');

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('192.168.1.1'),
      }),
    ).rejects.toThrow('Blocked connection to private address: 192.168.1.1');

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('172.16.0.1'),
      }),
    ).rejects.toThrow('Blocked connection to private address: 172.16.0.1');
  });

  it('blocks connection to IPv6 unique local address (ULA)', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('fc00::1', 6),
      }),
    ).rejects.toThrow('Blocked connection to private address: fc00::1');

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('fd00::1', 6),
      }),
    ).rejects.toThrow('Blocked connection to private address: fd00::1');
  });

  it('blocks connection to IPv6 link-local address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(
      safeFetch('https://example.com/v1', {
        dnsLookup: mockDns('fe80::1', 6),
      }),
    ).rejects.toThrow('Blocked connection to private address: fe80::1');
  });

  it('blocks connection to localhost with trailing dot immediately', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    await expect(safeFetch('http://localhost.:8080/v1')).rejects.toThrow(
      'Blocked connection to private destination: localhost.',
    );
  });

  it('blocks connection when DNS changes between validation and connection', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    const dns = rebindingDns('93.184.216.34', '127.0.0.1');

    await new Promise<void>((resolve, reject) => {
      dns('rebind.example.com', {}, (err, addrs) => {
        if (err) reject(err);
        const addr = Array.isArray(addrs) ? addrs[0]?.address : addrs;
        expect(addr).toBe('93.184.216.34');
        resolve();
      });
    });

    await expect(
      safeFetch('https://rebind.example.com/v1', {
        dnsLookup: dns,
      }),
    ).rejects.toThrow('Blocked connection to private address: 127.0.0.1');
  });

  it('permits connection to loopback when ALLOW_PRIVATE_AI_ENDPOINTS is enabled', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/test`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('connects to ordinary provider hostname starting with fc when resolving to mock server', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'connected' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://fc-ai.com:${port}/v1`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'connected' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('handles 204 No Content bodyless response safely without throwing outside promise', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const server = http.createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/no-content`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe('');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('handles 304 Not Modified bodyless response safely', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const server = http.createServer((_req, res) => {
      res.writeHead(304);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/not-modified`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(304);
      expect(response.body).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('handles HEAD request bodyless response safely', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const server = http.createServer((req, res) => {
      expect(req.method).toBe('HEAD');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/head`, {
        method: 'HEAD',
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('decompresses gzip-encoded JSON response bodies seamlessly', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const payload = JSON.stringify({
      model: 'gpt-4o',
      choices: [{ message: { content: 'hello' } }],
    });
    const gzipped = zlib.gzipSync(Buffer.from(payload));

    const server = http.createServer((req, res) => {
      expect(req.headers['accept-encoding']).toContain('gzip');
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gzipped.length),
      });
      res.end(gzipped);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/gzip`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(response.headers.get('content-length')).toBeNull();
      const parsed = (await response.json()) as {
        model: string;
        choices: { message: { content: string } }[];
      };
      expect(parsed).toEqual(JSON.parse(payload));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('decompresses deflate-encoded JSON response bodies seamlessly', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const payload = JSON.stringify({ provider: 'anthropic', text: 'response' });
    const deflated = zlib.deflateSync(Buffer.from(payload));

    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'deflate',
      });
      res.end(deflated);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/deflate`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(JSON.parse(payload));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('decompresses brotli-encoded JSON response bodies seamlessly', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const payload = JSON.stringify({ tokens: 150 });
    const brotlied = zlib.brotliCompressSync(Buffer.from(payload));

    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'br',
      });
      res.end(brotlied);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const response = await safeFetch(`http://127.0.0.1:${port}/brotli`, {
        dnsLookup: mockDns('127.0.0.1'),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(JSON.parse(payload));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
