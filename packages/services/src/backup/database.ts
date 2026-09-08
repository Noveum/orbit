import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import postgres from 'postgres';
import type { DatabaseDumpResult } from './types.ts';

export interface ParsedConnection {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password?: string | undefined;
  readonly database: string;
}

export function parseDatabaseConnection(connectionUrl: string): ParsedConnection {
  const parsed = new URL(connectionUrl);
  const host = parsed.hostname;
  const port = parsed.port.length > 0 ? parsed.port : '5432';
  const user = decodeURIComponent(parsed.username);
  const password = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : undefined;
  const database = parsed.pathname.replace(/^\//, '');

  if (host.length === 0 || user.length === 0 || database.length === 0) {
    throw new Error('DATABASE_URL must include host, username, and database name.');
  }

  return { host, port, user, password, database };
}

export async function queryDatabaseCounts(url: string): Promise<{
  readonly workspaces: number;
  readonly users: number;
  readonly attachments: number;
  readonly issues: number;
}> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 10,
    prepare: false,
  });
  try {
    const [orgRow] = await sql<{ count: number }[]>`
      select count(*)::int as count from organization
    `;
    const [userRow] = await sql<{ count: number }[]>`
      select count(*)::int as count from "user"
    `;
    const [attRow] = await sql<{ count: number }[]>`
      select count(*)::int as count from attachment
    `;
    const [issueRow] = await sql<{ count: number }[]>`
      select count(*)::int as count from issue
    `;

    return {
      workspaces: orgRow?.count ?? 0,
      users: userRow?.count ?? 0,
      attachments: attRow?.count ?? 0,
      issues: issueRow?.count ?? 0,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface DumpDatabaseOptions {
  readonly databaseUrl: string;
  readonly outputFile: string;
  readonly databaseVersion: string;
  readonly ledger: readonly { readonly hash: string; readonly createdAt: string }[];
  readonly pgDumpPath?: string | undefined;
  readonly snapshotId?: string | undefined;
  readonly counts?:
    | {
        readonly workspaces: number;
        readonly users: number;
        readonly attachments: number;
        readonly issues: number;
      }
    | undefined;
}

export async function dumpDatabase(options: DumpDatabaseOptions): Promise<DatabaseDumpResult> {
  const { databaseUrl, outputFile, databaseVersion, ledger, pgDumpPath, snapshotId } = options;
  const counts = options.counts ?? (await queryDatabaseCounts(databaseUrl));

  await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });

  const parsed = new URL(databaseUrl);
  const password = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : undefined;
  parsed.password = '';
  const sanitizedUrl = parsed.toString();

  const binary = pgDumpPath ?? process.env['PG_DUMP_PATH'] ?? 'pg_dump';
  const args = ['-Fc', '--no-owner', '--no-acl', '-d', sanitizedUrl];

  if (snapshotId !== undefined && snapshotId.length > 0) {
    args.push(`--snapshot=${snapshotId}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(password === undefined ? {} : { PGPASSWORD: password }),
  };

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([binary, ...args], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (error) {
    throw new Error(`Failed to spawn "${binary}": ${String(error)}`);
  }

  const hash = createHash('sha256');
  let byteCount = 0;

  const fileHandle = await open(outputFile, 'w', 0o600);
  try {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      hash.update(value);
      await fileHandle.write(value);
    }
  } finally {
    await fileHandle.close();
  }

  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`pg_dump exited with nonzero status code ${exitCode}: ${stderrText.trim()}`);
  }

  return {
    file: 'database.dump',
    sha256: hash.digest('hex'),
    bytes: byteCount,
    databaseVersion,
    migrationLedger: ledger,
    counts,
  };
}
