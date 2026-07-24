import { integration } from '@orbit/db/schema';
import { randomUUIDv7 } from 'bun';
import { and, eq, ne } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';

export async function ensureGithubInstallation(
  database: GithubDatabase,
  input: {
    readonly organizationId: string;
    readonly connectedById: string;
    readonly installationId: string;
  },
): Promise<string> {
  await database
    .delete(integration)
    .where(
      and(
        eq(integration.organizationId, input.organizationId),
        eq(integration.provider, 'github'),
        ne(integration.externalId, input.installationId),
      ),
    );
  const [row] = await database
    .insert(integration)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      provider: 'github',
      externalId: input.installationId,
      connectedById: input.connectedById,
    })
    .onConflictDoUpdate({
      target: [integration.organizationId, integration.provider, integration.externalId],
      set: { connectedById: input.connectedById, updatedAt: new Date() },
    })
    .returning({ id: integration.id });
  if (row === undefined) throw new Error('Could not persist the GitHub installation.');
  return row.id;
}
