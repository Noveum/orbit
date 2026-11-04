import { resolve } from 'node:path';

export interface ParsedArgs {
  readonly destination: string;
  readonly databaseUrl?: string | undefined;
  readonly json: boolean;
  readonly pgDumpPath?: string | undefined;
  readonly orbitVersion?: string | undefined;
  readonly sourceRevision?: string | undefined;
  readonly encrypt: boolean;
  readonly encryptionKeyFile?: string | undefined;
  readonly encryptionCommand?: string | undefined;
  readonly encryptionKeyId?: string | undefined;
}

function extractFlagMap(argv: readonly string[]): {
  flags: Map<string, string>;
  json: boolean;
  encrypt: boolean;
} {
  const flags = new Map<string, string>();
  let json = false;
  let encrypt = false;

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) continue;
    if (item === '--json') {
      json = true;
      continue;
    }
    if (item === '--encrypt') {
      encrypt = true;
      continue;
    }
    const eqIdx = item.indexOf('=');
    if (eqIdx !== -1) {
      flags.set(item.slice(0, eqIdx), item.slice(eqIdx + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('-')) {
      flags.set(item, next);
      index += 1;
    }
  }

  return { flags, json, encrypt };
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const { flags, json, encrypt: cliEncrypt } = extractFlagMap(argv);

  const destination = resolve(
    flags.get('--destination') ??
      flags.get('-d') ??
      process.env['ORBIT_BACKUP_DESTINATION'] ??
      './backups',
  );
  const databaseUrl =
    flags.get('--database-url') ?? process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  const pgDumpPath = flags.get('--pg-dump-path') ?? process.env['PG_DUMP_PATH'];
  const orbitVersion = flags.get('--orbit-version') ?? process.env['ORBIT_VERSION'];
  const sourceRevision =
    flags.get('--source-revision') ??
    process.env['SOURCE_REVISION'] ??
    process.env['VERCEL_GIT_COMMIT_SHA'];

  const encryptionKeyFile =
    flags.get('--encryption-key-file') ?? process.env['ORBIT_BACKUP_ENCRYPTION_KEY_FILE'];
  const encryptionCommand =
    flags.get('--encryption-command') ?? process.env['ORBIT_BACKUP_ENCRYPTION_COMMAND'];
  const encryptionKeyId =
    flags.get('--encryption-key-id') ?? process.env['ORBIT_BACKUP_ENCRYPTION_KEY_ID'];

  const encrypt =
    cliEncrypt ||
    encryptionKeyFile !== undefined ||
    encryptionCommand !== undefined ||
    flags.has('--encryption-key-id');

  return {
    destination,
    databaseUrl,
    json,
    pgDumpPath,
    orbitVersion,
    sourceRevision,
    encrypt,
    encryptionKeyFile,
    encryptionCommand,
    encryptionKeyId,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    if (args.json) {
      process.stderr.write(
        `${JSON.stringify(
          {
            status: 'error',
            error: 'DATABASE_URL or DIRECT_URL is required to create a backup.',
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stderr.write('Error: DATABASE_URL or DIRECT_URL is required to create a backup.\n');
    }
    process.exit(1);
  }

  try {
    const { createBackup } = await import('../../packages/services/src/backup/index.ts');
    const result = await createBackup({
      destinationDir: args.destination,
      databaseUrl: args.databaseUrl,
      pgDumpPath: args.pgDumpPath,
      orbitVersion: args.orbitVersion,
      sourceRevision: args.sourceRevision,
      encrypt: args.encrypt,
      encryptionKeyFile: args.encryptionKeyFile,
      encryptionCommand: args.encryptionCommand,
      encryptionKeyId: args.encryptionKeyId,
    });

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: 'ok',
            backupId: result.backupId,
            backupDir: result.backupDir,
            manifest: result.manifest,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`Backup successfully created.\n`);
      process.stdout.write(`ID: ${result.backupId}\n`);
      process.stdout.write(`Directory: ${result.backupDir}\n`);
      process.stdout.write(`Database version: ${result.manifest.databaseVersion}\n`);
      process.stdout.write(
        `Postgres dump: ${result.manifest.checksums.databaseDump.bytes} bytes\n`,
      );
      process.stdout.write(`Objects captured: ${result.manifest.checksums.objects.length}\n`);
      process.stdout.write(
        `Counts: ${result.manifest.counts.workspaces} workspace(s), ${result.manifest.counts.users} user(s), ${result.manifest.counts.attachments} attachment(s), ${result.manifest.counts.issues} issue(s)\n`,
      );
      if (result.manifest.encryption.enabled) {
        process.stdout.write(
          `Encryption: ${result.manifest.encryption.algorithm ?? 'aes-256-gcm'} (key ID: ${result.manifest.encryption.keyId ?? 'default'})\n`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      process.stderr.write(
        `${JSON.stringify(
          {
            status: 'error',
            error: message,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stderr.write(`Backup creation failed: ${message}\n`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
