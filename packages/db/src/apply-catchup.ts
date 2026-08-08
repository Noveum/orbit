import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import postgres from 'postgres';

const CATCHUP_DIR = new URL('../catchup/', import.meta.url).pathname;

export function catchupPath(named: string): string {
  const file = basename(named);
  if (file !== named.replace(/^.*\/catchup\//, '')) {
    throw new Error(`Name a file in packages/db/catchup, not ${named}.`);
  }
  if (!file.endsWith('.sql')) throw new Error(`${file} is not a .sql file.`);
  return resolve(join(CATCHUP_DIR, file));
}

export function targetName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
}

export async function applyCatchup(url: string, named: string): Promise<void> {
  const body = await readFile(catchupPath(named), 'utf8');
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 10 });
  try {
    await sql.unsafe(body).simple();
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (import.meta.main) {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    process.stderr.write('DATABASE_URL is not set.\n');
    process.exit(2);
  }

  const path = process.argv[2];
  if (path === undefined) {
    process.stderr.write('Pass the path of a file in packages/db/catchup.\n');
    process.exit(2);
  }

  process.stdout.write(`Applying ${path} to ${targetName(url)}\n`);
  await applyCatchup(url, path);
  process.stdout.write('Done. Run db:check-drift to confirm the database matches the schema.\n');
}
