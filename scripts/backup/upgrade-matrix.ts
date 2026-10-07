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
  readonly scenario?: UpgradeScenarioId | undefined;
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
  readonly json: boolean;
  readonly help: boolean;
}

const BOOLEAN_FLAGS: Record<string, 'json' | 'help'> = {
  '--json': 'json',
  '--help': 'help',
  '-h': 'help',
};

function extractFlags(argv: readonly string[]): FlagResult {
  const flags = new Map<string, string>();
  const state = { json: false, help: false };

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
  const { flags, json, help } = extractFlags(argv);
  const rawScenario = flags.get('--scenario');
  const scenario =
    rawScenario !== undefined && VALID_SCENARIOS.includes(rawScenario as UpgradeScenarioId)
      ? (rawScenario as UpgradeScenarioId)
      : undefined;

  return {
    databaseUrl:
      flags.get('--database-url') ?? process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'],
    scenario,
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

async function main(): Promise<void> {
  const args = parseMatrixArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    const errorMsg = 'DATABASE_URL or DIRECT_URL is required.';
    if (args.json) {
      process.stderr.write(JSON.stringify({ status: 'error', error: errorMsg }));
    } else {
      process.stderr.write(`Error: ${errorMsg}\n`);
    }
    process.exit(1);
  }

  try {
    if (!args.json) {
      process.stdout.write('Running Orbit 7-scenario upgrade matrix...\n\n');
    }

    const { runUpgradeMatrix } = await import('../../packages/services/src/backup/index.ts');
    const result = await runUpgradeMatrix({
      databaseUrl: args.databaseUrl,
      scenario: args.scenario,
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
