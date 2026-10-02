import { expect, test } from 'bun:test';
import { copyFile, link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { nodeRuntimePath } from '../../../scripts/next-dev-environment.ts';
import nextConfig from '../next.config.ts';

const webDirectory = resolve(import.meta.dir, '..');

test('the development server loads authentication, native hashing and signed workspace storage', async () => {
  const fixtureDirectory = join(webDirectory, '.artifacts');
  await mkdir(fixtureDirectory, { recursive: true });
  const directory = await mkdtemp(join(fixtureDirectory, 'next-dev-storage-'));
  const listener = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = listener.port;
  listener.stop(true);
  let output = '';
  try {
    await mkdir(join(directory, 'app', 'storage'), { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    await writeFile(
      join(directory, 'next.config.mjs'),
      `export default ${JSON.stringify(nextConfig(PHASE_DEVELOPMENT_SERVER))};\n`,
    );
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: { paths: { '@/*': ['../../src/*'] } },
        include: ['app/**/*.ts'],
      }),
    );
    await writeFile(
      join(directory, 'app', 'storage', 'route.ts'),
      `import { S3StorageDriver } from '@orbit/services/storage';
import { auth } from '../../../../src/lib/auth/server.ts';
import { hashPassword, verifyPassword } from '../../../../src/lib/auth/password.ts';

export async function GET() {
  const storage = new S3StorageDriver({
    bucket: 'storage-fixture',
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9010',
    accessKeyId: 'fixture-access',
    secretAccessKey: 'fixture-secret',
  });
  const digest = await hashPassword('fixture-password-valid-minimum');
  return Response.json({
    ...await storage.createUploadTarget('workspace/files/signed-length', 'text/plain', 7),
    authReady: typeof auth.handler === 'function',
    passwordVerified: await verifyPassword(digest, 'fixture-password-valid-minimum'),
    runtime: process.versions.bun === undefined ? 'node' : 'bun',
  });
}
`,
    );
    const executable =
      process.platform === 'win32' ? join(directory, 'bun-runtime.exe') : process.execPath;
    if (process.platform === 'win32') await copyFile(process.execPath, executable);
    const shimDirectory = join(directory, 'runtime-shim');
    await mkdir(shimDirectory);
    const createShim = process.platform === 'win32' ? link : symlink;
    await createShim(
      executable,
      join(shimDirectory, process.platform === 'win32' ? 'node.exe' : 'node'),
    );
    const inheritedPath = `${shimDirectory}${delimiter}${process.env['PATH'] ?? ''}`;
    const server = Bun.spawn(
      [executable, 'next', 'dev', directory, '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd: webDirectory,
        env: {
          ...process.env,
          PATH: await nodeRuntimePath(inheritedPath, executable),
          DATABASE_URL:
            'postgres://storage-fixture:storage-fixture@127.0.0.1:1/orbit_test_next_storage',
          BETTER_AUTH_SECRET: 'next-development-fixture-secret-0123456789abcdef',
          BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
          NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
          REDIS_URL: 'redis://127.0.0.1:1',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    async function collect(stream: ReadableStream<Uint8Array>): Promise<void> {
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      output += decoder.decode();
    }
    const collected = Promise.all([collect(server.stdout), collect(server.stderr)]);
    try {
      const deadline = Date.now() + 30_000;
      while (!output.includes('Ready in') && Date.now() < deadline && server.exitCode === null) {
        await Bun.sleep(20);
      }
      expect(output).toContain('Ready in');
      const response = await fetch(`http://127.0.0.1:${port}/storage`, {
        signal: AbortSignal.timeout(30_000),
      });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toEqual(
        expect.objectContaining({
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          maxBytes: 7,
          authReady: true,
          passwordVerified: true,
          runtime: 'node',
        }),
      );
      expect(body).toHaveProperty('url');
      if (
        body === null ||
        typeof body !== 'object' ||
        !('url' in body) ||
        typeof body.url !== 'string'
      ) {
        throw new Error('The storage route did not return a signed upload URL.');
      }
      const signed = new URL(body.url);
      expect(signed.pathname).toBe('/storage-fixture/workspace/files/signed-length');
      expect(signed.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain(
        'content-length',
      );
      expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
      expect(output).not.toContain('Cannot find module');
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, {
        cause: error,
      });
    } finally {
      server.kill();
      await server.exited;
      await collected;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
