import { avatarStorageKey, saveAvatar } from '../packages/core/src/org/avatar-service.ts';
import { db, eq, ilike, schema } from '../packages/db/src/index.ts';
import { storageDriver } from '../packages/services/src/storage/index.ts';

interface AvatarSource {
  readonly slug: string;
  readonly url: string;
}

const SOURCES: readonly AvatarSource[] = [
  { slug: 'pulkit', url: 'https://ca.slack-edge.com/T04V91GUX2T-U092J4H80JK-1871fd7d634f-512' },
  { slug: 'shashank', url: 'https://ca.slack-edge.com/T04V91GUX2T-U050N5XDQ0H-bdfb7bac8308-512' },
  { slug: 'shivam', url: 'https://ca.slack-edge.com/T04V91GUX2T-U08GZEJ53D1-bfd6cb4160dd-512' },
  { slug: 'aditi', url: 'https://ca.slack-edge.com/T04V91GUX2T-U086XCML82U-1cf562c133d0-512' },
  { slug: 'pragati', url: 'https://ca.slack-edge.com/T04V91GUX2T-U0AT9SYCLV6-a8fbe43f3c25-512' },
  { slug: 'tanzeela', url: 'https://ca.slack-edge.com/T04V91GUX2T-U094HMMC7U6-a2a0f9442abe-512' },
  { slug: 'harkirat', url: 'https://ca.slack-edge.com/T04V91GUX2T-U0ABKEK80NM-80672da20575-512' },
  { slug: 'koushik', url: 'https://ca.slack-edge.com/T04V91GUX2T-U09NX929PFW-d66216abe870-512' },
  { slug: 'vidushi', url: 'https://ca.slack-edge.com/T04V91GUX2T-U092J4H80JK-1871fd7d634f-512' },
];

type FoundUser = { readonly id: string; readonly name: string };

async function findUser(slug: string): Promise<FoundUser | null> {
  const byHandle = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.handle, slug))
    .limit(1);
  if (byHandle[0] !== undefined) return byHandle[0];

  const byEmail = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(ilike(schema.user.email, `${slug}@%`))
    .limit(1);
  if (byEmail[0] !== undefined) return byEmail[0];

  const byName = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(ilike(schema.user.name, `${slug}%`))
    .limit(2);
  return byName.length === 1 && byName[0] !== undefined ? byName[0] : null;
}

async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed with status ${response.status}`);
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error(`not an image (${contentType})`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
}

async function main(): Promise<void> {
  const storage = storageDriver();
  let applied = 0;
  const missing: string[] = [];

  for (const source of SOURCES) {
    const user = await findUser(source.slug);
    if (user === null) {
      missing.push(source.slug);
      console.warn(`skip ${source.slug}: no matching user`);
      continue;
    }
    const { bytes, contentType } = await download(source.url);
    await storage.put(avatarStorageKey(user.id), bytes, contentType);
    await saveAvatar(user.id);
    applied += 1;
    console.info(`ok   ${source.slug} -> ${user.name} (${user.id})`);
  }

  console.info(`\napplied ${applied}/${SOURCES.length} avatars`);
  if (missing.length > 0) console.info(`unmatched: ${missing.join(', ')}`);
}

await main();
process.exit(0);
