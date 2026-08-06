import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';

const TEST_DATABASE_NAME = /^orbit_test(?:_[a-z0-9]+)*$/;

function adminUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

function nameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

export async function ensureLaneDatabase(url: string, base: string): Promise<void> {
  const lane = currentLane();
  if (lane.length === 0) return;

  const database = nameOf(url);
  if (database !== laneDatabase(base, lane)) return;
  if (!(TEST_DATABASE_NAME.test(database) && TEST_DATABASE_NAME.test(base))) {
    throw new Error(`Refusing to clone "${base}" into "${database}".`);
  }

  const admin = postgres(adminUrl(url), { max: 1, idle_timeout: 5, onnotice: () => undefined });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${database}`;
    if (existing.length > 0) return;

    const template = await admin`select 1 from pg_database where datname = ${base}`;
    if (template.length === 0) {
      throw new Error(
        `The lane template "${base}" does not exist. Run bun run db:test-setup once before using ORBIT_TEST_LANE.`,
      );
    }
    await admin.unsafe(`create database "${database}" template "${base}"`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already exists')) return;
    if (message.includes('being accessed by other users')) {
      throw new Error(
        `Could not clone "${base}" into "${database}" because something is connected to the template. Stop any lane free test run and try again.`,
      );
    }
    throw error;
  } finally {
    await admin.end();
  }
}
