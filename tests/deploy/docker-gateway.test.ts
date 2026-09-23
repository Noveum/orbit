import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function docker(...args: string[]): Promise<string> {
  const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`Docker failed: ${stderr}`);
  return stdout.trim();
}

async function waitForGateway(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    if (response?.ok) return;
    await Bun.sleep(100);
  }
  throw new Error('Gateway did not start within ten seconds.');
}

async function withGateway(
  trustedProxies: string | undefined,
  run: (url: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-gateway-test-'));
  const name = `orbit-gateway-test-${crypto.randomUUID()}`;
  const template = await readFile(
    new URL('../../deploy/docker/Caddyfile', import.meta.url),
    'utf8',
  );
  const config = template
    .replaceAll('web:3000', '127.0.0.1:4000')
    .replaceAll('realtime:3100', '127.0.0.1:4100');
  await writeFile(
    join(directory, 'Caddyfile'),
    `${config}
:4000 {
  respond "web|{http.request.header.X-Forwarded-For}|{http.request.header.X-Forwarded-Proto}"
}
:4100 {
  respond "realtime|{http.request.header.X-Forwarded-For}"
}
`,
  );
  try {
    await docker(
      'run',
      '-d',
      '--name',
      name,
      '-p',
      '127.0.0.1::3000',
      '-v',
      `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
      ...(trustedProxies === undefined ? [] : ['-e', `ORBIT_TRUSTED_PROXIES=${trustedProxies}`]),
      'caddy:2-alpine',
    );
    const address = await docker('port', name, '3000/tcp');
    const url = `http://${address}`;
    await waitForGateway(url);
    await run(url);
  } finally {
    await docker('rm', '-f', name);
    await rm(directory, { recursive: true, force: true });
  }
}

test('trusted proxy users retain distinct single client addresses and ignore spoofed prefixes', async () => {
  await withGateway('private_ranges', async (url) => {
    for (const client of ['198.51.100.10', '198.51.100.11']) {
      const response = await fetch(`${url}/api/auth/sign-in/email`, {
        headers: { 'x-forwarded-for': `203.0.113.99, ${client}`, 'x-forwarded-proto': 'https' },
      });
      expect(await response.text()).toBe(`web|${client}|https`);
    }
    for (const path of ['/api/ws', '/api/realtime/health']) {
      const response = await fetch(`${url}${path}`, {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      });
      expect(await response.text()).toBe('realtime|198.51.100.10');
    }
  });
}, 120_000);

test('the default gateway does not accept forwarded addresses from an untrusted connection', async () => {
  await withGateway(undefined, async (url) => {
    const normal = await fetch(url);
    const expected = await normal.text();
    const spoofed = await fetch(url, {
      headers: { 'x-forwarded-for': '203.0.113.99', 'x-forwarded-proto': 'https' },
    });
    expect(await spoofed.text()).toBe(expected);
    expect(expected).not.toContain('203.0.113.99');
    expect(expected).not.toContain(',');
    expect(expected).toEndWith('|http');
  });
}, 120_000);
