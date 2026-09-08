import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
  const sql = postgres(url, { max: 1, idle_timeout: 10, prepare: false });
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
}

export async function dumpDatabase(options: DumpDatabaseOptions): Promise<DatabaseDumpResult> {
  const { databaseUrl, outputFile, databaseVersion, ledger, pgDumpPath } = options;
  const connection = parseDatabaseConnection(databaseUrl);
  const counts = await queryDatabaseCounts(databaseUrl);

  await mkdir(dirname(outputFile), { recursive: true });

  const binary = pgDumpPath ?? process.env['PG_DUMP_PATH'] ?? 'pg_dump';
  const args = [
    '-Fc',
    '--no-owner',
    '--no-acl',
    '-h',
    connection.host,
    '-p',
    connection.port,
    '-U',
    connection.user,
    '-d',
    connection.database,
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(connection.password === undefined ? {} : { PGPASSWORD: connection.password }),
  };

  const hash = createHash('sha256');
  let byteCount = 0;

  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error(`Failed to spawn "${binary}": ${String(error)}`));
      return;
    }

    const fileStream = createWriteStream(outputFile);
    let stderrOutput = '';

    child.on('error', (error) => {
      reject(new Error(`pg_dump execution failed (${binary}): ${error.message}`));
    });

    if (child.stderr !== null) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrOutput += chunk.toString();
      });
    }

    if (child.stdout !== null) {
      child.stdout.on('data', (chunk: Buffer) => {
        byteCount += chunk.length;
        hash.update(chunk);
      });
      child.stdout.pipe(fileStream);
    }

    fileStream.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      fileStream.close(() => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(`pg_dump exited with nonzero status code ${code}: ${stderrOutput.trim()}`),
          );
        }
      });
    });
  });

  return {
    file: 'database.dump',
    sha256: hash.digest('hex'),
    bytes: byteCount,
    databaseVersion,
    migrationLedger: ledger,
    counts,
  };
}
