import { expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function buildNodeFixture(entrypoint: string, directory: string): Promise<void> {
  const build = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      'build',
      entrypoint,
      '--target=node',
      '--format=esm',
      '--outfile',
      join(directory, 'fixture.mjs'),
    ],
    {
      env: { PATH: process.env['PATH'], NODE_ENV: 'test' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [, stderr, exitCode] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
}

it('rechecks DNS when a private override was used for an earlier Node request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-provider-node-policy-'));
  try {
    const entrypoint = join(directory, 'fixture.ts');
    await writeFile(
      entrypoint,
      `
import assert from 'node:assert/strict';
import http from 'node:http';
assert.equal(process.versions.bun, undefined);
import { setImmediate } from 'node:timers/promises';
import { safeFetch } from ${JSON.stringify(join(import.meta.dir, '../../src/ai/transport.ts'))};
let requests = 0;
const server = http.createServer((request, response) => {
  requests += 1;
  response.end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const dnsLookup = (hostname, options, callback) => callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
const url = 'http://provider.example:' + server.address().port + '/completion';
try {
  const first = await safeFetch(url, { allowPrivate: true, dnsLookup });
  await first.text();
  await setImmediate();
  await assert.rejects(async () => {
    const second = await safeFetch(url, { allowPrivate: false, dnsLookup });
    await second.text();
  }, /Blocked connection to private address/);
  assert.equal(requests, 1);
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log('Node provider DNS policy isolation passed');
`,
    );
    await buildNodeFixture(entrypoint, directory);
    const child = Bun.spawn(['node', join(directory, 'fixture.mjs')], {
      env: { PATH: process.env['PATH'], NODE_ENV: 'test' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(stdout).toContain('Node provider DNS policy isolation passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('sends string provider bodies with their UTF-8 length on the Node runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-provider-node-'));
  try {
    const entrypoint = join(directory, 'fixture.ts');
    await writeFile(
      entrypoint,
      `
import assert from 'node:assert/strict';
import http from 'node:http';
assert.equal(process.versions.bun, undefined);
import { safeFetch } from ${JSON.stringify(join(import.meta.dir, '../../src/ai/transport.ts'))};
for (const body of ['{"model":"fixture"}', '{"message":"héllo 🌍"}', '', undefined]) {
  const server = http.createServer((request, response) => {
    let received = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { received += chunk; });
    request.on('end', () => {
      const expectedLength = body === undefined ? undefined : String(Buffer.byteLength(body));
      response.writeHead(request.headers['content-length'] === expectedLength ? 200 : 411, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ received, transferEncoding: request.headers['transfer-encoding'] ?? null }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await safeFetch('http://127.0.0.1:' + server.address().port + '/completion', { method: body === undefined ? 'GET' : 'POST', body, allowPrivate: true });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result, { received: body ?? '', transferEncoding: null });
  } finally {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}
console.log('Node provider framing passed');
`,
    );
    await buildNodeFixture(entrypoint, directory);
    const child = Bun.spawn(['node', join(directory, 'fixture.mjs')], {
      env: { PATH: process.env['PATH'], NODE_ENV: 'test' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(stdout).toContain('Node provider framing passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
