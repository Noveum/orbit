import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { internal, validationFailed } from '@orbit/shared';
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
    throw validationFailed('DATABASE_URL must include host, username, and database name.');
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

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(internal(`Failed to spawn "${binary}": ${String(error)}`, error));
      return;
    }

    if (child.stdout === null) {
      reject(internal('pg_dump stdout stream is not available'));
      return;
    }

    const hash = createHash('sha256');
    let byteCount = 0;

    const fileStream = createWriteStream(outputFile, { mode: 0o600 });
    let stderrText = '';

    if (child.stderr !== null) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrText += chunk;
      });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
      hash.update(chunk);
    });

    fileStream.on('error', (err) => {
      child.stdout?.unpipe(fileStream);
      child.stdout?.destroy();
      child.kill('SIGTERM');
      reject(err);
    });

    child.on('error', (err) => {
      fileStream.destroy();
      reject(internal(`Failed to spawn "${binary}": ${err.message}`, err));
    });

    child.on('close', (code) => {
      fileStream.end(() => {
        if (code === 0) {
          resolve({
            file: 'database.dump',
            sha256: hash.digest('hex'),
            bytes: byteCount,
            databaseVersion,
            migrationLedger: ledger,
            counts,
          });
        } else {
          reject(
            internal(
              `pg_dump exited with nonzero status code ${code ?? 'unknown'}: ${stderrText.trim()}`,
            ),
          );
        }
      });
    });

    child.stdout.pipe(fileStream);
  });
}
