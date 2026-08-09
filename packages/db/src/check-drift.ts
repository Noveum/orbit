import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export interface ExpectedTable {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface Drift {
  readonly missingTables: readonly string[];
  readonly missingColumns: readonly { table: string; column: string }[];
  readonly undeclaredTables: readonly string[];
}

function isPgTable(value: unknown): value is PgTable {
  if (typeof value !== 'object' || value === null) return false;
  try {
    getTableConfig(value as PgTable);
    return true;
  } catch {
    return false;
  }
}

export function expectedTables(module: Record<string, unknown>): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(module)) {
    if (!isPgTable(value)) continue;
    const config = getTableConfig(value);
    tables.push({
      name: config.name,
      columns: config.columns.map((column) => column.name).sort(),
    });
  }
  return tables.sort((left, right) => left.name.localeCompare(right.name));
}

export function driftBetween(
  expected: readonly ExpectedTable[],
  live: ReadonlyMap<string, ReadonlySet<string>>,
): Drift {
  const missingTables: string[] = [];
  const missingColumns: { table: string; column: string }[] = [];

  for (const table of expected) {
    const columns = live.get(table.name);
    if (columns === undefined) {
      missingTables.push(table.name);
      continue;
    }
    for (const column of table.columns) {
      if (!columns.has(column)) missingColumns.push({ table: table.name, column });
    }
  }

  const declared = new Set(expected.map((table) => table.name));
  const undeclaredTables = [...live.keys()].filter((name) => !declared.has(name)).sort();

  return { missingTables, missingColumns, undeclaredTables };
}

export function isBehind(drift: Drift): boolean {
  return drift.missingTables.length > 0 || drift.missingColumns.length > 0;
}

export function describeDrift(drift: Drift, target: string): string {
  const lines: string[] = [];

  if (isBehind(drift)) {
    lines.push(`${target} is behind packages/db/src/schema:`);
    for (const table of drift.missingTables) lines.push(`  missing table   ${table}`);
    for (const { table, column } of drift.missingColumns) {
      lines.push(`  missing column  ${table}.${column}`);
    }
    lines.push(
      '',
      'Apply the matching script in packages/db/catchup before shipping code that reads it.',
    );
  } else {
    lines.push(`${target} has every table and column the schema declares.`);
  }

  lines.push(
    '',
    'This compares table and column names only. A column that exists but is not generated,',
    'a missing index, constraint or enum value: none of those are reported here.',
  );

  if (drift.undeclaredTables.length > 0) {
    lines.push(
      '',
      'Tables the schema no longer declares, which db:push would DROP along with their rows:',
    );
    for (const table of drift.undeclaredTables) lines.push(`  ${table}`);
  }

  lines.push('');
  return lines.join('\n');
}

export async function liveColumns(url: string): Promise<Map<string, Set<string>>> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `;
    const live = new Map<string, Set<string>>();
    for (const row of rows) {
      const columns = live.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      live.set(row.table_name, columns);
    }
    return live;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function targetName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'The configured database';
  }
}

const GUARD_FLAG = '--guard-deploy';

if (import.meta.main) {
  const guarding = process.argv.includes(GUARD_FLAG);
  const url = process.env['DATABASE_URL'];

  if (url === undefined || url.length === 0) {
    if (!guarding) {
      process.stderr.write('DATABASE_URL is not set.\n');
      process.exit(2);
    }
    process.stdout.write('No DATABASE_URL, so there is no database to check against.\n');
    process.exit(0);
  }

  let live: Map<string, Set<string>>;
  try {
    live = await liveColumns(url);
  } catch (error) {
    if (!guarding) throw error;
    process.stdout.write(
      `Could not reach ${targetName(url)}, so its schema went unchecked: ${String(error)}\n`,
    );
    process.exit(0);
  }

  const drift = driftBetween(expectedTables(schema), live);
  process.stdout.write(describeDrift(drift, targetName(url)));
  if (!isBehind(drift)) process.exit(0);
  if (guarding) {
    process.stdout.write(
      '\nRefusing to build against a database that cannot answer what this code asks for.\n' +
        'Apply the matching script in packages/db/catchup, then build again.\n',
    );
  }
  process.exit(1);
}
