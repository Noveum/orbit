import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { internal, validationFailed } from '@orbit/shared';
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

export interface DumpDatabaseOptions {
  readonly databaseUrl: string;
  readonly outputFile: string;
  readonly databaseVersion: string;
  readonly ledger: readonly { readonly hash: string; readonly createdAt: string }[];
  readonly pgDumpPath?: string | undefined;
  readonly snapshotId: string;
  readonly counts: {
    readonly workspaces: number;
    readonly users: number;
    readonly attachments: number;
    readonly issues: number;
  };
}

export async function dumpDatabase(options: DumpDatabaseOptions): Promise<DatabaseDumpResult> {
  const { databaseUrl, outputFile, databaseVersion, ledger, pgDumpPath, snapshotId, counts } =
    options;

  await mkdir(dirname(outputFile), { recursive: true, mode: 0o700 });

  const parsed = new URL(databaseUrl);
  const password = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : undefined;
  parsed.password = '';
  const sanitizedUrl = parsed.toString();

  const binary = pgDumpPath ?? process.env['PG_DUMP_PATH'] ?? 'pg_dump';
  const args = ['-Fc', '--no-owner', '--no-acl', '-d', sanitizedUrl, `--snapshot=${snapshotId}`];

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

    let settled = false;
    let exitCode: number | null = null;
    let streamFinished = false;

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const settleResolve = (val: DatabaseDumpResult) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const checkComplete = () => {
      if (settled || exitCode === null || !streamFinished) return;
      if (exitCode === 0) {
        settleResolve({
          file: 'database.dump',
          sha256: hash.digest('hex'),
          bytes: byteCount,
          databaseVersion,
          migrationLedger: ledger,
          counts,
        });
      } else {
        settleReject(
          internal(`pg_dump exited with nonzero status code ${exitCode}: ${stderrText.trim()}`),
        );
      }
    };

    fileStream.on('finish', () => {
      streamFinished = true;
      checkComplete();
    });

    fileStream.on('error', (err) => {
      child.stdout?.unpipe(fileStream);
      child.stdout?.destroy();
      child.kill('SIGTERM');
      settleReject(err);
    });

    child.on('error', (err) => {
      fileStream.destroy();
      settleReject(internal(`Failed to spawn "${binary}": ${err.message}`, err));
    });

    child.on('close', (code) => {
      exitCode = code ?? -1;
      checkComplete();
    });

    child.stdout.pipe(fileStream);
  });
}
