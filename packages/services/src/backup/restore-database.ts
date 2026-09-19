import { spawn } from 'node:child_process';
import { internal, validationFailed } from '@orbit/shared';

export interface RestoreDatabaseOptions {
  readonly databaseUrl: string;
  readonly dumpFile: string;
  readonly pgRestorePath?: string | undefined;
}

export interface RestoreDatabaseResult {
  readonly success: boolean;
  readonly durationMs: number;
}

export function restoreDatabase(options: RestoreDatabaseOptions): Promise<RestoreDatabaseResult> {
  const { databaseUrl, dumpFile, pgRestorePath } = options;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw validationFailed('Invalid database connection URL for restore.', { cause: error });
  }

  let password: string | undefined;
  try {
    password = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : undefined;
  } catch (error) {
    throw validationFailed('Database connection credentials could not be decoded.', {
      cause: error,
    });
  }

  parsed.password = '';
  const sanitizedUrl = parsed.toString();

  const binary = pgRestorePath ?? process.env['PG_RESTORE_PATH'] ?? 'pg_restore';
  const args = [
    '-Fc',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '-d',
    sanitizedUrl,
    dumpFile,
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(password === undefined ? {} : { PGPASSWORD: password }),
  };

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(internal(`Failed to spawn "${binary}": ${String(error)}`, error));
      return;
    }

    let stderrText = '';
    if (child.stderr !== null) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrText += chunk;
      });
    }

    child.on('error', (err) => {
      reject(internal(`Failed to execute "${binary}": ${err.message}`, err));
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        resolve({ success: true, durationMs });
      } else {
        reject(
          internal(
            `pg_restore exited with nonzero status code ${code ?? -1}: ${stderrText.trim()}`,
          ),
        );
      }
    });
  });
}
