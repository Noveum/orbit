import { resolve } from 'node:path';

export interface ParsedRestoreArgs {
  readonly backupPath: string;
  readonly confirmTarget?: string | undefined;
  readonly databaseUrl?: string | undefined;
  readonly pgRestorePath?: string | undefined;
  readonly skipObjectRestore: boolean;
  readonly skipRedisCheck: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

const BOOL_FLAGS: Record<string, string> = {
  '--json': 'json',
  '--skip-object-restore': 'skipObjectRestore',
  '--skip-redis-check': 'skipRedisCheck',
  '--help': 'help',
  '-h': 'help',
};

function parseBoolFlags(item: string, state: Record<string, boolean>): boolean {
  const key = BOOL_FLAGS[item];
  if (key === undefined) return false;
  state[key] = true;
  return true;
}

function parseValueArg(
  item: string,
  index: number,
  argv: readonly string[],
  flags: Map<string, string>,
): number {
  const eqIdx = item.indexOf('=');
  if (eqIdx !== -1) {
    flags.set(item.slice(0, eqIdx), item.slice(eqIdx + 1));
    return index;
  }
  if (item.startsWith('-')) {
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('-')) {
      flags.set(item, next);
      return index + 1;
    }
  }
  return index;
}

function parseFlags(argv: readonly string[]): {
  flags: Map<string, string>;
  json: boolean;
  skipObjectRestore: boolean;
  skipRedisCheck: boolean;
  help: boolean;
  positionalBackupPath: string | undefined;
} {
  const flags = new Map<string, string>();
  const boolState: Record<string, boolean> = {
    json: false,
    skipObjectRestore: false,
    skipRedisCheck: false,
    help: false,
  };
  let positionalBackupPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) continue;
    if (parseBoolFlags(item, boolState)) continue;
    const next = parseValueArg(item, index, argv, flags);
    if (next !== index) {
      index = next;
      continue;
    }
    if (!item.startsWith('-') && positionalBackupPath === undefined) {
      positionalBackupPath = item;
    }
  }

  return {
    flags,
    json: boolState['json'] === true,
    skipObjectRestore: boolState['skipObjectRestore'] === true,
    skipRedisCheck: boolState['skipRedisCheck'] === true,
    help: boolState['help'] === true,
    positionalBackupPath,
  };
}

export function parseRestoreArgs(argv: readonly string[]): ParsedRestoreArgs {
  const { flags, json, skipObjectRestore, skipRedisCheck, help, positionalBackupPath } =
    parseFlags(argv);

  const rawPath =
    flags.get('--backup-path') ??
    flags.get('-b') ??
    positionalBackupPath ??
    process.env['ORBIT_BACKUP_PATH'] ??
    '';

  const backupPath = rawPath.length > 0 ? resolve(rawPath) : '';
  const confirmTarget =
    flags.get('--confirm-destructive-restore-target') ??
    process.env['ORBIT_RESTORE_CONFIRM_TARGET'];
  const databaseUrl =
    flags.get('--database-url') ?? process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  const pgRestorePath = flags.get('--pg-restore-path') ?? process.env['PG_RESTORE_PATH'];

  return {
    backupPath,
    confirmTarget,
    databaseUrl,
    pgRestorePath,
    skipObjectRestore,
    skipRedisCheck,
    json,
    help,
  };
}

function printHelp(): void {
  process.stdout.write(`Orbit Backup Restore

Usage:
  bun run backup:restore <backup-path> [options]

Options:
  --confirm-destructive-restore-target=<target>   Required target identity confirmation string
  --database-url=<url>                            Target direct PostgreSQL connection URL
  --pg-restore-path=<path>                        Path to local pg_restore binary
  --skip-object-restore                           Skip object storage restoration
  --skip-redis-check                              Skip Redis ping check
  --json                                          Emit machine-readable JSON output
  --help, -h                                      Show this help message
`);
}

function writeError(message: string, json: boolean): void {
  if (json) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: message }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
}

function validateRequiredArgs(args: ParsedRestoreArgs): string | undefined {
  if (args.backupPath.length === 0) {
    return 'Backup path or manifest.json path is required.';
  }
  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    return 'DATABASE_URL or DIRECT_URL is required to restore a backup.';
  }
  if (args.confirmTarget === undefined || args.confirmTarget.length === 0) {
    return 'Explicit target confirmation is required via --confirm-destructive-restore-target=<target> or ORBIT_RESTORE_CONFIRM_TARGET.';
  }
  return undefined;
}

function printRestoreSuccess(
  result: {
    targetIdentity: string;
    databaseRestored: boolean;
    objectsReconciled: number;
    validation: {
      integrity: { organizations: number; users: number; issues: number; attachments: number };
      durationMs: number;
    };
  },
  json: boolean,
): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'ok',
          targetIdentity: result.targetIdentity,
          databaseRestored: result.databaseRestored,
          objectsReconciled: result.objectsReconciled,
          validation: result.validation,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`Restore and validation successfully completed.\n`);
    process.stdout.write(`Target: ${result.targetIdentity}\n`);
    process.stdout.write(`Database restored: ${result.databaseRestored ? 'yes' : 'no'}\n`);
    process.stdout.write(`Objects reconciled: ${result.objectsReconciled}\n`);
    process.stdout.write(
      `Integrity: ${result.validation.integrity.organizations} org(s), ${result.validation.integrity.users} user(s), ${result.validation.integrity.issues} issue(s), ${result.validation.integrity.attachments} attachment(s)\n`,
    );
    process.stdout.write(`Validation duration: ${result.validation.durationMs}ms\n`);
  }
}

async function main(): Promise<void> {
  const args = parseRestoreArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const validationError = validateRequiredArgs(args);
  if (validationError !== undefined) {
    writeError(validationError, args.json);
    if (!args.json && args.backupPath.length === 0) {
      printHelp();
    }
    process.exit(1);
  }

  try {
    const { restoreBackup } = await import('../../packages/services/src/backup/index.ts');
    const result = await restoreBackup({
      backupPath: args.backupPath,
      confirmDestructiveRestoreTarget: args.confirmTarget as string,
      databaseUrl: args.databaseUrl,
      pgRestorePath: args.pgRestorePath,
      skipObjectRestore: args.skipObjectRestore,
      skipRedisCheck: args.skipRedisCheck,
    });

    printRestoreSuccess(result, args.json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      process.stderr.write(`${JSON.stringify({ status: 'error', error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`Restore failed: ${message}\n`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
