import { expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('sends string provider bodies with their UTF-8 length on the Node runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-provider-node-'));
  try {
    const entrypoint = join(directory, 'fixture.ts');
    await writeFile(
      entrypoint,
      `
import assert from 'node:assert/strict';
import http from 'node:http';
import { safeFetch } from ${JSON.stringify(join(import.meta.dir, '../../src/ai/transport.ts'))};
for (const body of ['{"model":"fixture"}', '{"message":"héllo 🌍"}', '']) {
  const server = http.createServer((request, response) => {
    let received = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { received += chunk; });
    request.on('end', () => {
      response.writeHead(request.headers['content-length'] === String(Buffer.byteLength(body)) ? 200 : 411, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ received, transferEncoding: request.headers['transfer-encoding'] ?? null }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await safeFetch('http://127.0.0.1:' + server.address().port + '/completion', { method: 'POST', body, allowPrivate: true });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result, { received: body, transferEncoding: null });
  } finally {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
}
console.log('Node provider framing passed');
`,
    );
    const build = await Bun.build({
      entrypoints: [entrypoint],
      outdir: directory,
      target: 'node',
      format: 'esm',
      naming: 'fixture.mjs',
    });
    expect(build.success).toBe(true);
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
