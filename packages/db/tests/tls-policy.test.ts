import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { resolveDatabaseTls } from '../src/tls-policy.ts';

const URL = 'postgres://sensitive-user:sensitive-password@database.invalid:9/private';
const REQUIRED = { DATABASE_REQUIRE_TLS: 'true' };
let directory: string;
let certificate: string;

async function command(args: string[]): Promise<string> {
  const child = Bun.spawn(args, {
    env: { PATH: process.env['PATH'] },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exit !== 0) throw new Error(`Local fixture command failed: ${stderr}${stdout}`);
  return stdout;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orbit-tls-fixture-'));
  await writeFile(join(directory, 'openssl.cnf'), '[req]\ndistinguished_name=dn\n[dn]\n');
  await command([
    'openssl',
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-config',
    join(directory, 'openssl.cnf'),
    '-subj',
    '/CN=Orbit local TLS fixture',
    '-addext',
    'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout',
    join(directory, 'key.pem'),
    '-out',
    join(directory, 'cert.pem'),
  ]);
  certificate = await readFile(join(directory, 'cert.pem'), 'utf8');
  await command([
    'openssl',
    'req',
    '-x509',
    '-key',
    join(directory, 'key.pem'),
    '-days',
    '1',
    '-config',
    join(directory, 'openssl.cnf'),
    '-subj',
    '/CN=Orbit wrong hostname fixture',
    '-addext',
    'subjectAltName=DNS:wrong.invalid',
    '-out',
    join(directory, 'wrong-host.pem'),
  ]);
  await command([
    process.execPath,
    '--no-env-file',
    'build',
    new globalThis.URL('./fixtures/tls-node.ts', import.meta.url).pathname,
    '--target=node',
    '--format=esm',
    '--outfile',
    join(directory, 'fixture.mjs'),
  ]);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('database TLS policy', () => {
  it('preserves the existing local default and supports explicit opt out', () => {
    expect(resolveDatabaseTls(URL, {})).toBeUndefined();
    expect(resolveDatabaseTls(URL, { DATABASE_REQUIRE_TLS: 'false' })).toBeUndefined();
  });

  it('requires certificate verification with the standard trust store', () => {
    expect(resolveDatabaseTls(URL, REQUIRED)).toEqual({ rejectUnauthorized: true });
    expect(resolveDatabaseTls(`${URL}?sslmode=verify-full`, REQUIRED)).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('adds public CA certificates to standard trust without overriding hostname verification', () => {
    const options = resolveDatabaseTls(URL, { ...REQUIRED, DATABASE_TLS_CA_PEM: certificate });
    expect(options?.rejectUnauthorized).toBe(true);
    expect(options?.ca).toContain(certificate.trim());
    expect(options?.ca).toContain(rootCertificates[0]);
    expect(options?.checkServerIdentity).toBeUndefined();
    expect(options?.servername).toBeUndefined();
  });

  it('overrides weaker URL and environment SSL settings with verified TLS', () => {
    for (const query of [
      'sslmode=disable',
      'sslmode=require',
      'sslmode=prefer',
      'sslmode=allow',
      'sslmode=verify-ca',
      'ssl=false',
      '%73sl=false',
      's\tsl=false',
      'sslmode=disable&sslmode=verify-full',
    ]) {
      expect(
        resolveDatabaseTls(`${URL}?${query}`, {
          ...REQUIRED,
          PGSSL: 'require',
          PGSSLMODE: 'disable',
        }),
      ).toEqual({ rejectUnauthorized: true });
    }
  });

  it('rejects unsupported certificate file and negotiation query settings', () => {
    for (const query of ['sslrootcert=system', 'sslnegotiation=direct', 'sslcert=private-file']) {
      expect(() => resolveDatabaseTls(`${URL}?${query}`, REQUIRED)).toThrow(
        'Invalid database TLS configuration',
      );
    }
  });

  it('rejects invalid policy values and private or malformed certificate material without reflecting secrets', () => {
    for (const environment of [
      { DATABASE_REQUIRE_TLS: 'TRUE' },
      { DATABASE_TLS_CA_PEM: certificate },
      { ...REQUIRED, DATABASE_TLS_CA_PEM: 'sensitive-private-key' },
      { ...REQUIRED, DATABASE_TLS_CA_PEM: `${certificate}\n-----BEGIN PRIVATE KEY-----secret` },
      { ...REQUIRED, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    ]) {
      let message = '';
      try {
        resolveDatabaseTls(URL, environment);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('Invalid database TLS configuration');
      expect(message).not.toMatch(/sensitive|private-key|secret|127\.0\.0\.1/u);
    }
  });
});

describe('actual Node postgres app pool TLS', () => {
  for (const [mode, query, pgssl] of [
    ['valid', '', ''],
    ['untrusted', '', ''],
    ['wrong-host', '', ''],
    ['refused', '', ''],
    ['valid', 'sslmode=require', 'require'],
    ['untrusted', 'sslmode=require', 'require'],
    ['valid', 'ssl=disable', 'false'],
    ['untrusted', 'ssl=disable', 'false'],
    ['wrong-host', 'sslmode=prefer', 'prefer'],
    ['refused', 'sslmode=prefer', 'prefer'],
    ['valid-ip', 'ssl=disable', 'false'],
    ['wrong-host-ip', 'sslmode=require', 'require'],
  ] as const) {
    it(`verifies ${mode}/${query}/${pgssl} without sending a plaintext startup packet`, async () => {
      const result: unknown = JSON.parse(
        await command([
          'node',
          join(directory, 'fixture.mjs'),
          mode,
          join(directory, mode.startsWith('wrong-host') ? 'wrong-host.pem' : 'cert.pem'),
          join(directory, 'key.pem'),
          query,
          pgssl,
        ]),
      );
      expect(result).toMatchObject({
        ok: true,
        authorized: mode.startsWith('valid'),
        startupPackets: 0,
      });
    });
  }
});
