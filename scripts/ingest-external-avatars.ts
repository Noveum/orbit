import { ingestExternalAvatar } from '../packages/core/src/org/avatar-service.ts';
import { and, db, ilike, isNotNull, not, schema } from '../packages/db/src/index.ts';

const rows = await db
  .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
  .from(schema.user)
  .where(and(isNotNull(schema.user.image), not(ilike(schema.user.image, '/api/avatars/%'))));

console.info(`found ${rows.length} users with an external image url`);

let ingested = 0;
const dropped: string[] = [];
for (const row of rows) {
  if (row.image === null) continue;
  const ok = await ingestExternalAvatar(row.id, row.image);
  if (ok) {
    ingested += 1;
    console.info(`ok   ${row.name} (${row.id})`);
  } else {
    dropped.push(row.name);
    console.warn(`drop ${row.name} (${row.id}): external image unreachable, cleared`);
  }
}

console.info(`\ningested ${ingested}/${rows.length}; cleared ${dropped.length}`);
if (dropped.length > 0) console.info(`cleared: ${dropped.join(', ')}`);
process.exit(0);
