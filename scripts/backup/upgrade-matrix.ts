export type UpgradeScenarioId =
  | 'fresh_install'
  | 'direct_upgrade'
  | 'backup_restore_upgrade'
  | 'direct_restore_current'
  | 'interrupted_migration_repair'
  | 'application_rollback'
  | 'unsafe_rollback_refusal';

export interface ParsedMatrixArgs {
  readonly databaseUrl?: string | undefined;
  readonly confirmDestructive?: string | undefined;
  readonly scenario?: UpgradeScenarioId | undefined;
  readonly skipDestructive: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

const VALID_SCENARIOS: readonly UpgradeScenarioId[] = [
  'fresh_install',
  'direct_upgrade',
  'backup_restore_upgrade',
  'direct_restore_current',
  'interrupted_migration_repair',
  'application_rollback',
  'unsafe_rollback_refusal',
];

interface FlagResult {
  readonly flags: Map<string, string>;
  readonly skipDestructive: boolean;
  readonly json: boolean;
  readonly help: boolean;
}

const BOOLEAN_FLAGS: Record<string, 'json' | 'skipDestructive' | 'help'> = {
  '--json': 'json',
  '--skip-destructive': 'skipDestructive',
  '--help': 'help',
  '-h': 'help',
};

function extractFlags(argv: readonly string[]): FlagResult {
  const flags = new Map<string, string>();
  const state = { json: false, skipDestructive: false, help: false };

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

export function parseMatrixArgs(argv: readonly string[]): ParsedMatrixArgs {
  const { flags, skipDestructive, json, help } = extractFlags(argv);
  const rawScenario = flags.get('--scenario');
  if (rawScenario !== undefined && !VALID_SCENARIOS.includes(rawScenario as UpgradeScenarioId)) {
    throw new Error(
      `Invalid upgrade scenario "${rawScenario}". Valid scenarios: ${VALID_SCENARIOS.join(', ')}`,
    );
  }
  const scenario = rawScenario as UpgradeScenarioId | undefined;

  return {
    databaseUrl: flags.get('--database-url') ?? process.env['ORBIT_DRILL_DATABASE_URL'],
    confirmDestructive:
      flags.get('--confirm-destructive') ??
      flags.get('--confirm-destructive-restore-target') ??
      process.env['ORBIT_DRILL_CONFIRM_TARGET'],
    scenario,
    skipDestructive,
    json,
    help,
  };
}

function printUsage(): void {
  process.stdout.write(`Usage: bun scripts/backup/upgrade-matrix.ts [options]

Tests the 7-scenario upgrade and recovery matrix:
  1. fresh install
  2. previous stable to current stable direct upgrade
  3. backup on previous stable -> restore on previous stable -> upgrade
  4. backup on previous stable -> direct restore into current stable
  5. interrupted migration and forward-repair
  6. application rollback when no irreversible schema change occurred
  7. explicit refusal when rollback is unsafe

Options:
  --database-url=<url>       Target database connection URL (default: DATABASE_URL / DIRECT_URL)
  --scenario=<id>            Run a single scenario (${VALID_SCENARIOS.join(', ')})
  --json                     Emit machine-readable JSON result
  -h, --help                 Show this help message
`);
}

function printHumanMatrixResults(result: {
  allPassed: boolean;
  totalDurationMs: number;
  scenarios: readonly {
    name: string;
    passed: boolean;
    durationMs: number;
    error?: string | undefined;
  }[];
}): void {
  process.stdout.write('Scenario Results:\n');
  for (const sc of result.scenarios) {
    const mark = sc.passed ? '[PASS]' : '[FAIL]';
    process.stdout.write(`  ${mark} ${sc.name} (${sc.durationMs} ms)\n`);
    if (sc.error !== undefined) {
      process.stdout.write(`         Error: ${sc.error}\n`);
    }
  }
  process.stdout.write(`\nTotal Duration: ${result.totalDurationMs} ms\n`);
  process.stdout.write(
    `Overall Status: ${result.allPassed ? 'ALL PASSED' : 'FAILURES DETECTED'}\n`,
  );
}

function emitError(message: string, isJson: boolean): never {
  if (isJson) {
    process.stderr.write(JSON.stringify({ status: 'error', error: message }));
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(1);
}

function parseArgsOrExit(): ParsedMatrixArgs {
  try {
    return parseMatrixArgs(process.argv);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    return emitError(message, process.argv.includes('--json'));
  }
}

interface ValidatedMatrixArgs {
  readonly databaseUrl: string;
}

function validateMatrixArgs(args: ParsedMatrixArgs): ValidatedMatrixArgs {
  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    emitError(
      'Database connection URL is required via --database-url or ORBIT_DRILL_DATABASE_URL.',
      args.json,
    );
  }

  const runsDestructive =
    !args.skipDestructive &&
    (args.scenario === undefined ||
      args.scenario === 'backup_restore_upgrade' ||
      args.scenario === 'direct_restore_current');

  if (
    runsDestructive &&
    (args.confirmDestructive === undefined || args.confirmDestructive.length === 0)
  ) {
    emitError(
      'Destructive confirmation is required via --confirm-destructive=<identity> or ORBIT_DRILL_CONFIRM_TARGET. Alternatively pass --skip-destructive.',
      args.json,
    );
  }

  return { databaseUrl: args.databaseUrl };
}

async function main(): Promise<void> {
  const args = parseArgsOrExit();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const { databaseUrl } = validateMatrixArgs(args);

  try {
    if (!args.json) {
      process.stdout.write('Running Orbit 7-scenario upgrade matrix...\n\n');
    }

    const { runUpgradeMatrix } = await import('../../packages/services/src/backup/index.ts');
    const result = await runUpgradeMatrix({
      databaseUrl,
      confirmDestructiveTarget: args.confirmDestructive,
      scenario: args.scenario,
      skipDestructive: args.skipDestructive,
    });

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ status: result.allPassed ? 'ok' : 'failed', ...result }, null, 2)}\n`,
      );
    } else {
      printHumanMatrixResults(result);
    }

    if (!result.allPassed) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      process.stderr.write(JSON.stringify({ status: 'error', error: message }));
    } else {
      process.stderr.write(`Upgrade matrix error: ${message}\n`);
    }
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('upgrade-matrix.ts')) {
  main().catch((err) => {
    process.stderr.write(`Unhandled matrix error: ${String(err)}\n`);
    process.exit(1);
  });
}
