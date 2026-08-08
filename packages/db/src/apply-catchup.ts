import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

export function targetName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'the configured database';
  }
}

export async function applyCatchup(url: string, path: string): Promise<void> {
  const body = await readFile(path, 'utf8');
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
