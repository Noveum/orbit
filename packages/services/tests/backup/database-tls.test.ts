import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { z } from 'zod';
import { dumpDatabase } from '../../src/backup/database.ts';
import { withDatabaseTlsContext } from '../../src/backup/database-tls.ts';
import { restoreDatabase } from '../../src/backup/restore-database.ts';

const target = 'postgres://fixture:synthetic-password@127.0.0.1:9/orbit_test_tls?sslmode=disable';
const environmentKeys = [
  'DATABASE_REQUIRE_TLS',
  'DATABASE_TLS_CA_PEM',
  'PGSSLMODE',
  'ORBIT_TLS_FIXTURE_REPORT',
  'ORBIT_TLS_FIXTURE_BEHAVIOR',
] as const;
let directory: string;
let binary: string;
let previous: Record<string, string | undefined>;
let contextsBefore: string[];

const reportSchema = z.object({
  url: z.string(),
  password: z.string(),
  mode: z.string(),
  caPath: z.string(),
  hasStandardRoot: z.boolean(),
  fileMode: z.number(),
  directoryMode: z.number(),
});

async function contexts(): Promise<string[]> {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('orbit-database-tls-'))
    .map((entry) => entry.name)
    .sort();
}

beforeEach(async () => {
  previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  contextsBefore = await contexts();
  directory = await mkdtemp(join(tmpdir(), 'orbit-native-tls-test-'));
  binary = join(directory, 'fake-postgres');
  process.env['DATABASE_REQUIRE_TLS'] = 'true';
  delete process.env['DATABASE_TLS_CA_PEM'];
  process.env['PGSSLMODE'] = 'disable';
  process.env['ORBIT_TLS_FIXTURE_REPORT'] = join(directory, 'report.json');
  process.env['ORBIT_TLS_FIXTURE_BEHAVIOR'] = 'success';
  await writeFile(
    binary,
    `#!${process.execPath}
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {rootCertificates} from 'node:tls';
const args=process.argv.slice(2);
const raw=args[args.indexOf('-d')+1];
const url=new URL(raw);
const caPath=url.searchParams.get('sslrootcert');
const contents=readFileSync(caPath,'utf8');
writeFileSync(process.env.ORBIT_TLS_FIXTURE_REPORT,JSON.stringify({url:raw,password:process.env.PGPASSWORD,mode:url.searchParams.get('sslmode'),caPath,hasStandardRoot:contents.includes(rootCertificates[0]),fileMode:statSync(caPath).mode&511,directoryMode:statSync(dirname(caPath)).mode&511}));
if(process.env.ORBIT_TLS_FIXTURE_BEHAVIOR==='fail')process.exit(2);
if(process.env.ORBIT_TLS_FIXTURE_BEHAVIOR==='wait')setInterval(()=>{},1000);
else process.stdout.write('synthetic-dump');
`,
    { mode: 0o700 },
  );
});

afterEach(async () => {
  for (const key of environmentKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  expect(await contexts()).toEqual(contextsBefore);
  await rm(directory, { recursive: true, force: true });
});

async function report() {
  const value = reportSchema.parse(
    JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')),
  );
  expect(value.mode).toBe('verify-full');
  expect(value.url).not.toContain('synthetic-password');
  expect(value.password).toBe('synthetic-password');
  expect(value.hasStandardRoot).toBe(true);
  expect(value.fileMode).toBe(0o600);
  expect(value.directoryMode).toBe(0o700);
  expect(await Bun.file(value.caPath).exists()).toBe(false);
  return value;
}

function dump(outputFile = join(directory, 'database.dump'), path = binary) {
  return dumpDatabase({
    databaseUrl: target,
    outputFile,
    databaseVersion: 'fixture',
    ledger: [],
    snapshotId: 'fixture',
    counts: { workspaces: 0, users: 0, attachments: 0, issues: 0 },
    pgDumpPath: path,
  });
}

describe('native database verified TLS', () => {
  it('leaves native connection parameters unchanged when the policy is off', async () => {
    process.env['DATABASE_REQUIRE_TLS'] = 'false';
    expect(await withDatabaseTlsContext(target, async (url) => url)).toBe(target);
  });

  it('adds provided public CA material alongside standard roots and cleans on callback failure', async () => {
    const certificate = rootCertificates[0];
    if (certificate === undefined) throw new Error('Missing standard root fixture.');
    process.env['DATABASE_TLS_CA_PEM'] = certificate;
    let caPath = '';
    await expect(
      withDatabaseTlsContext(target, async (raw) => {
        const url = new URL(raw);
        caPath = url.searchParams.get('sslrootcert') ?? '';
        expect(url.searchParams.getAll('sslmode')).toEqual(['verify-full']);
        expect((await readFile(caPath, 'utf8')).split(certificate).length).toBeGreaterThan(2);
        throw new Error('synthetic callback failure');
      }),
    ).rejects.toThrow('synthetic callback failure');
    expect(await Bun.file(caPath).exists()).toBe(false);
  });

  for (const operation of ['dump', 'restore'] as const) {
    for (const behavior of ['success', 'fail', 'spawn-error'] as const) {
      it(`cleans verified native ${operation} context after ${behavior}`, async () => {
        process.env['ORBIT_TLS_FIXTURE_BEHAVIOR'] = behavior;
        const path = behavior === 'spawn-error' ? join(directory, 'missing-binary') : binary;
        const pending =
          operation === 'dump'
            ? dump(undefined, path)
            : restoreDatabase({
                databaseUrl: target,
                dumpFile: join(directory, 'unused.dump'),
                pgRestorePath: path,
              });
        if (behavior === 'success') await pending;
        else await expect(pending).rejects.toThrow();
        if (behavior !== 'spawn-error') await report();
      });
    }
  }

  it('cleans native TLS context on restore pre-abort without spawning a process', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      restoreDatabase({
        databaseUrl: target,
        dumpFile: 'unused',
        pgRestorePath: binary,
        signal: controller.signal,
      }),
    ).rejects.toThrow('aborted');
    expect(await Bun.file(join(directory, 'report.json')).exists()).toBe(false);
  });

  it('cleans native TLS context and terminates only its restore child on abort', async () => {
    process.env['ORBIT_TLS_FIXTURE_BEHAVIOR'] = 'wait';
    const controller = new AbortController();
    const pending = restoreDatabase({
      databaseUrl: target,
      dumpFile: 'unused',
      pgRestorePath: binary,
      signal: controller.signal,
    });
    const result = pending.then(
      () => null,
      (error: unknown) => error,
    );
    const marker = join(directory, 'report.json');
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      ready = await stat(marker).then(
        () => true,
        () => false,
      );
      if (ready) break;
      await Bun.sleep(5);
    }
    controller.abort();
    expect(await result).toMatchObject({ message: expect.stringContaining('aborted') });
    expect(ready).toBe(true);
    await report();
  });

  it('cleans native dump context after output stream failure', async () => {
    const blocked = join(directory, 'blocked');
    await mkdir(blocked);
    await expect(dump(blocked)).rejects.toThrow();
  });
});
