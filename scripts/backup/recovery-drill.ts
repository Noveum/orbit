import { resolve } from 'node:path';

export interface ParsedDrillArgs {
  readonly databaseUrl?: string | undefined;
  readonly confirmDestructive?: string | undefined;
  readonly destination?: string | undefined;
  readonly encryptionKey?: string | undefined;
  readonly redisUrl?: string | undefined;
  readonly skipRedis: boolean;
  readonly cleanDestination: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

interface FlagMapResult {
  readonly flags: Map<string, string>;
  readonly json: boolean;
  readonly skipRedis: boolean;
  readonly cleanDestination: boolean;
  readonly help: boolean;
}

const BOOLEAN_FLAGS: Record<string, 'json' | 'skipRedis' | 'cleanDestination' | 'help'> = {
  '--json': 'json',
  '--skip-redis': 'skipRedis',
  '--clean': 'cleanDestination',
  '--help': 'help',
  '-h': 'help',
};

function extractFlags(argv: readonly string[]): FlagMapResult {
  const flags = new Map<string, string>();
  const state = { json: false, skipRedis: false, cleanDestination: false, help: false };

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) continue;

    const boolKey = BOOLEAN_FLAGS[item];
    if (boolKey !== undefined) {
      state[boolKey] = true;
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

  return { flags, ...state };
}

export function parseDrillArgs(argv: readonly string[]): ParsedDrillArgs {
  const { flags, json, skipRedis, cleanDestination, help } = extractFlags(argv);
  const rawDest = flags.get('--destination') ?? flags.get('-d');

  return {
    databaseUrl: flags.get('--database-url') ?? process.env['ORBIT_DRILL_DATABASE_URL'],
    confirmDestructive:
      flags.get('--confirm-destructive') ??
      flags.get('--confirm-destructive-restore-target') ??
      process.env['ORBIT_DRILL_CONFIRM_TARGET'],
    destination: rawDest === undefined ? undefined : resolve(rawDest),
    encryptionKey: flags.get('--encryption-key') ?? process.env['ORBIT_BACKUP_ENCRYPTION_KEY'],
    redisUrl: flags.get('--redis-url') ?? process.env['ORBIT_DRILL_REDIS_URL'],
    skipRedis,
    cleanDestination,
    json,
    help,
  };
}

function printUsage(): void {
  process.stdout.write(`Usage: bun scripts/backup/recovery-drill.ts [options]

Proves automated continuous recovery: seeds representative data, creates an encrypted backup,
destroys test database and bucket, restores into blank environment with empty Redis,
and verifies byte-for-byte attachment integrity and authorization boundaries.

Options:
  --database-url=<url>       Target database connection URL (default: DATABASE_URL / DIRECT_URL)
  --destination=<path>       Backup destination directory (default: system temporary directory)
  --encryption-key=<hex>     Master 256-bit encryption key (default: ephemeral key generated)
  --redis-url=<url>          Redis URL for empty start verification (default: REDIS_URL)
  --skip-redis               Skip Redis empty start pub/sub verification
  --clean                    Clean destination directory after drill finishes
  --json                     Emit machine-readable JSON result
  -h, --help                 Show this help message
`);
}

function printHumanSummary(result: {
  success: boolean;
  metrics: {
    backupDurationMs: number;
    restoreDurationMs: number;
    backupSizeBytes: number;
    databaseDumpSizeBytes: number;
    objectsCount: number;
    objectsTotalBytes: number;
    encryptionAlgorithm: string;
    orbitVersion: string;
    formatVersion: string;
    attachmentsVerifiedCount: number;
  };
  errors: readonly string[];
}): void {
  process.stdout.write('\n--- Recovery Drill Results ---\n');
  process.stdout.write(`Status:                      ${result.success ? 'PASSED' : 'FAILED'}\n`);
  process.stdout.write(`Backup Duration:             ${result.metrics.backupDurationMs} ms\n`);
  process.stdout.write(`Restore Duration:            ${result.metrics.restoreDurationMs} ms\n`);
  process.stdout.write(`Backup Archive Size:         ${result.metrics.backupSizeBytes} bytes\n`);
  process.stdout.write(
    `Database Dump Size:          ${result.metrics.databaseDumpSizeBytes} bytes\n`,
  );
  process.stdout.write(`Objects Verified:            ${result.metrics.objectsCount}\n`);
  process.stdout.write(`Total Object Bytes:          ${result.metrics.objectsTotalBytes} bytes\n`);
  process.stdout.write(`Encryption Algorithm:        ${result.metrics.encryptionAlgorithm}\n`);
  process.stdout.write(`Orbit Version:               ${result.metrics.orbitVersion}\n`);
  process.stdout.write(`Format Version:              ${result.metrics.formatVersion}\n`);
  process.stdout.write(`Attachments Checked:         ${result.metrics.attachmentsVerifiedCount}\n`);

  if (result.errors.length > 0) {
    process.stdout.write('\nErrors:\n');
    for (const err of result.errors) {
      process.stdout.write(`  - ${err}\n`);
    }
  }
}

function emitError(message: string, isJson: boolean): never {
  if (isJson) {
    process.stderr.write(JSON.stringify({ status: 'error', error: message }));
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
}

interface ValidatedDrillArgs {
  readonly databaseUrl: string;
  readonly confirmDestructive: string;
}

function validateDrillArgs(args: ParsedDrillArgs): ValidatedDrillArgs {
  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    emitError(
      'Database connection URL is required via --database-url or ORBIT_DRILL_DATABASE_URL.',
      args.json,
    );
  }

  if (args.confirmDestructive === undefined || args.confirmDestructive.length === 0) {
    emitError(
      'Destructive confirmation is required via --confirm-destructive=<identity> or ORBIT_DRILL_CONFIRM_TARGET.',
      args.json,
    );
  }

  return {
    databaseUrl: args.databaseUrl,
    confirmDestructive: args.confirmDestructive,
  };
}

async function main(): Promise<void> {
  const args = parseDrillArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const { databaseUrl, confirmDestructive } = validateDrillArgs(args);

  try {
    if (!args.json) {
      process.stdout.write('Starting Orbit continuous recovery drill...\n');
    }

    const { runRecoveryDrill } = await import('../../packages/services/src/backup/index.ts');
    const result = await runRecoveryDrill({
      databaseUrl,
      confirmDestructiveTarget: confirmDestructive,
      destinationDir: args.destination,
      encryptionKey: args.encryptionKey,
      redisUrl: args.redisUrl,
      skipRedisCheck: args.skipRedis,
      cleanDestination: args.cleanDestination,
    });

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ status: result.success ? 'ok' : 'failed', ...result }, null, 2)}\n`,
      );
    } else {
      printHumanSummary(result);
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      process.stderr.write(JSON.stringify({ status: 'error', error: message }));
    } else {
      process.stderr.write(`Recovery drill failed: ${message}\n`);
    }
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('recovery-drill.ts')) {
  main().catch((err) => {
    process.stderr.write(`Unhandled drill error: ${String(err)}\n`);
    process.exit(1);
  });
}
