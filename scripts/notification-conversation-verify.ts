import { db, pool } from '../packages/db/src/index.ts';
import { verifyNotificationConversationBackfill } from '../packages/services/src/notifications/index.ts';

const args = process.argv.slice(2);

for (const value of args) {
  if (!value.startsWith('--organization=')) {
    throw new Error(`Unknown notification conversation verifier argument "${value}".`);
  }
}

function organizationIds(): string[] {
  const prefix = '--organization=';
  const values = args
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
  if (values.some((value) => value.length === 0)) {
    throw new Error('--organization cannot be empty.');
  }
  return values;
}

async function main(): Promise<void> {
  const organizations = organizationIds();
  const result = await verifyNotificationConversationBackfill(db, {
    ...(organizations.length === 0 ? {} : { organizationIds: organizations }),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  await main();
} finally {
  await pool.end();
}
