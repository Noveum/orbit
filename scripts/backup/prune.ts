import { resolve } from 'node:path';
import { type BackupPruneResult, validationFailed } from '@orbit/shared';
import { parseByteSize } from '../../packages/services/src/backup/prune.ts';

export interface ParsedPruneArgs {
  readonly destination: string;
  readonly keepCount?: number | undefined;
  readonly keepDays?: number | undefined;
  readonly keepHourly?: number | undefined;
  readonly keepDaily?: number | undefined;
  readonly keepWeekly?: number | undefined;
  readonly keepMonthly?: number | undefined;
  readonly maxTotalBytes?: number | undefined;
  readonly cleanIncomplete: boolean;
  readonly incompleteMaxAgeHours?: number | undefined;
  readonly staleAlertHours?: number | undefined;
  readonly pinnedBackupIds?: readonly string[] | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

const BOOL_FLAGS: Record<string, string> = {
  '--json': 'json',
  '--dry-run': 'dryRun',
  '--clean-incomplete': 'cleanIncomplete',
  '--no-clean-incomplete': 'noCleanIncomplete',
  '--help': 'help',
  '-h': 'help',
};

function parseValue(
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

function extractPruneFlags(argv: readonly string[]): {
  flags: Map<string, string>;
  bools: Record<string, boolean>;
} {
  const flags = new Map<string, string>();
  const bools: Record<string, boolean> = {
    json: false,
    dryRun: false,
    cleanIncomplete: true,
    noCleanIncomplete: false,
    help: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) continue;

    const boolKey = BOOL_FLAGS[item];
    if (boolKey !== undefined) {
      bools[boolKey] = true;
      continue;
    }

    const nextIndex = parseValue(item, index, argv, flags);
    if (nextIndex !== index) {
      index = nextIndex;
    }
  }

  return { flags, bools };
}

function parseOptionalInt(val: string | undefined, flagName = 'flag'): number | undefined {
  if (val === undefined || val.trim().length === 0) return undefined;
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw validationFailed(`Flag ${flagName} must be a non-negative integer: "${val}"`);
  }
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(num) || num < 0) {
    throw validationFailed(`Flag ${flagName} must be a non-negative integer: "${val}"`);
  }
  return num;
}

export function parsePruneArgs(argv: readonly string[]): ParsedPruneArgs {
  const { flags, bools } = extractPruneFlags(argv);

  const destination = resolve(
    flags.get('--destination') ??
      flags.get('-d') ??
      process.env['ORBIT_BACKUP_DESTINATION'] ??
      './backups',
  );

  const keepCount = parseOptionalInt(
    flags.get('--keep-count') ?? process.env['ORBIT_BACKUP_KEEP_COUNT'],
    '--keep-count',
  );
  const keepDays = parseOptionalInt(
    flags.get('--keep-days') ?? process.env['ORBIT_BACKUP_KEEP_DAYS'],
    '--keep-days',
  );
  const keepHourly = parseOptionalInt(
    flags.get('--keep-hourly') ?? process.env['ORBIT_BACKUP_KEEP_HOURLY'],
    '--keep-hourly',
  );
  const keepDaily = parseOptionalInt(
    flags.get('--keep-daily') ?? process.env['ORBIT_BACKUP_KEEP_DAILY'],
    '--keep-daily',
  );
  const keepWeekly = parseOptionalInt(
    flags.get('--keep-weekly') ?? process.env['ORBIT_BACKUP_KEEP_WEEKLY'],
    '--keep-weekly',
  );
  const keepMonthly = parseOptionalInt(
    flags.get('--keep-monthly') ?? process.env['ORBIT_BACKUP_KEEP_MONTHLY'],
    '--keep-monthly',
  );
  const staleAlertHours = parseOptionalInt(
    flags.get('--stale-alert-hours') ?? process.env['ORBIT_BACKUP_STALE_ALERT_HOURS'],
    '--stale-alert-hours',
  );
  const incompleteMaxAgeHours = parseOptionalInt(
    flags.get('--incomplete-max-age-hours') ?? process.env['ORBIT_BACKUP_INCOMPLETE_MAX_AGE_HOURS'],
    '--incomplete-max-age-hours',
  );

  const rawBytes = flags.get('--max-bytes') ?? process.env['ORBIT_BACKUP_MAX_BYTES'];
  const maxTotalBytes =
    rawBytes === undefined || rawBytes.trim().length === 0 ? undefined : parseByteSize(rawBytes);

  const rawPinned = flags.get('--pinned') ?? process.env['ORBIT_BACKUP_PINNED'];
  const pinnedBackupIds =
    rawPinned === undefined || rawPinned.trim().length === 0
      ? undefined
      : rawPinned
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

  const cleanIncomplete =
    bools['noCleanIncomplete'] === true ? false : (bools['cleanIncomplete'] ?? true);

  return {
    destination,
    keepCount,
    keepDays,
    keepHourly,
    keepDaily,
    keepWeekly,
    keepMonthly,
    maxTotalBytes,
    cleanIncomplete,
    incompleteMaxAgeHours,
    staleAlertHours,
    pinnedBackupIds,
    dryRun: bools['dryRun'] === true,
    json: bools['json'] === true,
    help: bools['help'] === true,
  };
}

function printHelp(): void {
  process.stdout.write(`Orbit Backup Retention and Pruning

Usage:
  bun run backup:prune [options]

Options:
  --destination, -d <dir>          Backup directory to inspect and prune (default: ./backups)
  --keep-count=<N>                 Retain the N newest backups
  --keep-days=<N>                  Retain backups newer than N days
  --keep-hourly=<N>                Retain newest backup for each of the last N hourly slots
  --keep-daily=<N>                 Retain newest backup for each of the last N daily slots
  --keep-weekly=<N>                Retain newest backup for each of the last N weekly slots
  --keep-monthly=<N>               Retain newest backup for each of the last N monthly slots
  --max-bytes=<size>               Storage quota limit (e.g. 50GB, 500MB, 1000000000)
  --pinned=<ids>                   Comma-separated list of backup IDs to pin
  --clean-incomplete               Remove .incomplete and .tmp failed backup directories (default: true)
  --no-clean-incomplete            Preserve .incomplete and .tmp failed backup directories
  --incomplete-max-age-hours=<N>   Age threshold in hours before cleaning .tmp directories (default: 24)
  --stale-alert-hours=<N>          Warn if newest backup is older than N hours
  --dry-run                        Preview pruning decisions without deleting files
  --json                           Emit machine-readable JSON output
  --help, -h                       Show this help message
`);
}

async function main(): Promise<void> {
  const args = parsePruneArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  try {
    const { pruneBackups } = await import('../../packages/services/src/backup/index.ts');
    const result = await pruneBackups({
      destinationDir: args.destination,
      keepCount: args.keepCount,
      keepDays: args.keepDays,
      keepHourly: args.keepHourly,
      keepDaily: args.keepDaily,
      keepWeekly: args.keepWeekly,
      keepMonthly: args.keepMonthly,
      maxTotalBytes: args.maxTotalBytes,
      cleanIncomplete: args.cleanIncomplete,
      incompleteMaxAgeHours: args.incompleteMaxAgeHours,
      staleAlertHours: args.staleAlertHours,
      pinnedBackupIds: args.pinnedBackupIds,
      dryRun: args.dryRun,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ status: 'ok', ...result }, null, 2)}\n`);
    } else {
      printHumanReport(args, result);
    }

    const hasFailures = handleFailedDeletions(args, result.failedDeletions);

    if (result.isStale && !hasFailures) {
      process.exitCode = 2;
    }
  } catch (error) {
    handlePruneError(args, error);
  }
}

function printHumanReport(args: ParsedPruneArgs, result: BackupPruneResult): void {
  const modePrefix = result.dryRun ? '[DRY RUN] ' : '';
  process.stdout.write(`${modePrefix}Backup retention and pruning completed.\n`);
  process.stdout.write(`Destination: ${args.destination}\n`);
  process.stdout.write(`Evaluated: ${result.evaluatedCount}\n`);
  process.stdout.write(`Retained: ${result.retainedBackups.length}\n`);
  process.stdout.write(`Deleted: ${result.deletedBackups.length}\n`);
  process.stdout.write(`Pinned: ${result.pinnedBackups.length}\n`);
  process.stdout.write(`Incomplete cleaned: ${result.deletedIncomplete.length}\n`);
  process.stdout.write(`Freed space: ${result.freedBytes} bytes\n`);
  process.stdout.write(`Remaining space: ${result.totalRemainingBytes} bytes\n`);
  process.stdout.write(`Newest backup: ${result.newestGoodBackupId ?? 'none'}\n`);

  if (result.isStale) {
    process.stderr.write(
      `WARNING: Backups are stale! Newest backup is ${result.staleAgeHours} hours old (threshold: ${args.staleAlertHours} hours).\n`,
    );
  }
}

function handleFailedDeletions(args: ParsedPruneArgs, failedDeletions: readonly string[]): boolean {
  if (failedDeletions.length === 0) {
    return false;
  }
  if (args.json) {
    process.stderr.write(
      `${JSON.stringify(
        {
          status: 'error',
          error: `Failed to delete ${failedDeletions.length} backup directory(ies).`,
          failedDeletions,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(
      `Error: Failed to delete ${failedDeletions.length} backup directory(ies): ${failedDeletions.join(', ')}\n`,
    );
  }
  process.exitCode = 1;
  return true;
}

function handlePruneError(args: ParsedPruneArgs, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (args.json) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: message }, null, 2)}\n`);
  } else {
    process.stderr.write(`Prune failed: ${message}\n`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
