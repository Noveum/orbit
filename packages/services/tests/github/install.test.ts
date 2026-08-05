import { describe, expect, it } from 'bun:test';
import { integration, organization, user } from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq } from 'drizzle-orm';
import { ensureGithubInstallation } from '../../src/github/install.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

async function seed(tx: TestTransaction): Promise<{ organizationId: string; userId: string }> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name: 'Acme', slug: `acme-${suffix.toLowerCase()}` });
  await tx.insert(user).values({
    id: userId,
    name: 'Ada',
    email: `ada.${suffix}@orbit.local`,
    handle: `ada-${suffix.toLowerCase()}`,
  });
  return { organizationId, userId };
}

function githubRows(tx: TestTransaction, organizationId: string) {
  return tx
    .select({ id: integration.id, externalId: integration.externalId })
    .from(integration)
    .where(and(eq(integration.organizationId, organizationId), eq(integration.provider, 'github')));
}

describe('ensureGithubInstallation', () => {
  it('replaces a stale installation so only the latest remains', async () => {
    await withRollback(async (tx) => {
      const { organizationId, userId } = await seed(tx);
      await ensureGithubInstallation(tx, {
        organizationId,
        connectedById: userId,
        installationId: '148719427',
      });
      await ensureGithubInstallation(tx, {
        organizationId,
        connectedById: userId,
        installationId: '148726691',
      });

      const rows = await githubRows(tx, organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.externalId).toBe('148726691');
    });
  });

  it('reuses the row when the same installation reconnects', async () => {
    await withRollback(async (tx) => {
      const { organizationId, userId } = await seed(tx);
      const first = await ensureGithubInstallation(tx, {
        organizationId,
        connectedById: userId,
        installationId: '555',
      });
      const second = await ensureGithubInstallation(tx, {
        organizationId,
        connectedById: userId,
        installationId: '555',
      });

      expect(second).toBe(first);
      expect(await githubRows(tx, organizationId)).toHaveLength(1);
    });
  });

  it('leaves other providers untouched', async () => {
    await withRollback(async (tx) => {
      const { organizationId, userId } = await seed(tx);
      await tx.insert(integration).values({
        id: randomUUIDv7(),
        organizationId,
        provider: 'slack',
        externalId: 'T1',
        connectedById: userId,
        credentials: { botToken: 'x' },
      });

      await ensureGithubInstallation(tx, {
        organizationId,
        connectedById: userId,
        installationId: '999',
      });

      const providers = await tx
        .select({ provider: integration.provider })
        .from(integration)
        .where(eq(integration.organizationId, organizationId));
      expect(providers.map((p) => p.provider).sort()).toEqual(['github', 'slack']);
    });
  });
});
