export interface ParsedValidateArgs {
  readonly databaseUrl?: string | undefined;
  readonly json: boolean;
  readonly skipRedisCheck: boolean;
}

export function parseValidateArgs(argv: readonly string[]): ParsedValidateArgs {
  const flags = new Map<string, string>();
  let json = false;
  let skipRedisCheck = false;

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) continue;

    if (item === '--json') {
      json = true;
      continue;
    }
    if (item === '--skip-redis-check') {
      skipRedisCheck = true;
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

  const databaseUrl =
    flags.get('--database-url') ?? process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];

  return { databaseUrl, json, skipRedisCheck };
}

function writeJsonResult(
  result: {
    valid: boolean;
    integrity: { organizations: number; users: number; issues: number };
    errors: string[];
  },
  json: boolean,
): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ status: result.valid ? 'ok' : 'invalid', validation: result }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`Validation status: ${result.valid ? 'PASSED' : 'FAILED'}\n`);
    process.stdout.write(
      `Integrity: ${result.integrity.organizations} org(s), ${result.integrity.users} user(s), ${result.integrity.issues} issue(s)\n`,
    );
    if (result.errors.length > 0) {
      process.stdout.write(`Errors:\n${result.errors.map((e) => `  - ${e}`).join('\n')}\n`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseValidateArgs(process.argv);

  if (args.databaseUrl === undefined || args.databaseUrl.length === 0) {
    const errorMsg = 'DATABASE_URL or DIRECT_URL is required to validate application recovery.';
    if (args.json) {
      process.stderr.write(`${JSON.stringify({ status: 'error', error: errorMsg }, null, 2)}\n`);
    } else {
      process.stderr.write(`Error: ${errorMsg}\n`);
    }
    process.exit(1);
  }

  try {
    const { validateRestore } = await import('../../packages/services/src/backup/index.ts');
    const result = await validateRestore({
      databaseUrl: args.databaseUrl,
      skipRedisCheck: args.skipRedisCheck,
    });

    writeJsonResult(result, args.json);

    if (!result.valid) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      process.stderr.write(`${JSON.stringify({ status: 'error', error: message }, null, 2)}\n`);
    } else {
      process.stderr.write(`Validation execution error: ${message}\n`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
