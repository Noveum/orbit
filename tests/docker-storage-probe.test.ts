import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test.each(['none', 'methods', 'headers', 'put-origin', 'get-origin'])(
  'the storage probe validates custom origins with missing CORS field: %s',
  async (missing) => {
    const origin = 'https://orbit.example.com';
    const objects = new Map<string, { body: ArrayBuffer; type: string }>();
    const origins: string[] = [];
    let uploads = 0;
    let downloads = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (request.method === 'OPTIONS') {
          const offered = request.headers.get('origin') ?? '';
          origins.push(offered);
          return new Response(null, {
            status: 204,
            headers:
              offered === origin
                ? {
                    'access-control-allow-origin': origin,
                    ...(missing === 'methods'
                      ? {}
                      : { 'access-control-allow-methods': 'GET, PUT' }),
                    ...(missing === 'headers'
                      ? {}
                      : { 'access-control-allow-headers': 'Content-Type' }),
                  }
                : {},
          });
        }
        if (request.method === 'PUT') {
          uploads += 1;
          objects.set(path, {
            body: await request.arrayBuffer(),
            type: request.headers.get('content-type') ?? '',
          });
          return new Response(null, {
            headers: {
              etag: '"probe"',
              ...(missing === 'put-origin' ? {} : { 'access-control-allow-origin': origin }),
            },
          });
        }
        if (request.method === 'DELETE') {
          objects.delete(path);
          return new Response(null, { status: 204 });
        }
        const object = objects.get(path);
        if (object === undefined) return new Response(null, { status: 404 });
        if (request.method === 'GET') downloads += 1;
        return new Response(request.method === 'HEAD' ? null : object.body, {
          headers: {
            'content-type': object.type,
            ...(missing === 'get-origin' ? {} : { 'access-control-allow-origin': origin }),
            'content-length': String(object.body.byteLength),
            etag: '"probe"',
          },
        });
      },
    });
    try {
      const child = Bun.spawn([process.execPath, 'scripts/smoke-docker-storage.ts'], {
        cwd: resolve(import.meta.dir, '..'),
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://probe:probe@127.0.0.1:1/orbit_test_probe',
          NEXT_PUBLIC_APP_URL: `${origin}/`,
          S3_ENDPOINT: server.url.toString(),
          S3_BUCKET: 'probe',
          S3_REGION: 'us-east-1',
          S3_ACCESS_KEY_ID: 'probe-access',
          S3_SECRET_ACCESS_KEY: 'probe-secret',
          S3_FORCE_PATH_STYLE: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(objects.size).toBe(0);
      if (missing !== 'none') {
        expect(code).not.toBe(0);
        expect(errors).toContain('AssertionError');
        return;
      }
      expect(errors).toBe('');
      expect(code).toBe(0);
      expect(output.match(/Verified presigned upload/g)).toHaveLength(3);
      expect(uploads).toBe(3);
      expect(downloads).toBe(3);
      expect(objects.size).toBe(0);
      expect(origins.filter((value) => value === origin)).toHaveLength(3);
      expect(origins.filter((value) => value === 'https://unrelated.example')).toHaveLength(3);
    } finally {
      await server.stop(true);
    }
  },
  30_000,
);
