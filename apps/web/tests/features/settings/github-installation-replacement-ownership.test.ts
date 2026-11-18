import { describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { completeGithubInstall } from '../../../src/features/settings/github-connect.ts';
import {
  createReplacementFixture,
  replacementAdministrator,
  replacementConfig,
} from './github-replacement-fixture.ts';

describe('replacement boundary reconnect ownership', () => {
  for (const kind of ['same-ID', 'replacement-ID'] as const) {
    it(`keeps the ${kind} verified reconnect alive when its previous administrator is deleted`, async () => {
      const fixture = await createReplacementFixture();
      const administrator = await replacementAdministrator(fixture.workspace.organizationId);
      if (kind === 'replacement-ID') fixture.state.oldAvailable = false;
      const connected = await completeGithubInstall({
        organizationId: fixture.workspace.organizationId,
        userId: administrator.id,
        installationId: kind === 'same-ID' ? fixture.oldId : fixture.newId,
        code: `local-current-manager-${randomUUIDv7()}`,
        config: replacementConfig,
        fetch: fixture.fetch,
      });
      const [integrationBefore] = await db
        .select()
        .from(schema.integration)
        .where(eq(schema.integration.id, fixture.original.integrationId));
      await db.delete(schema.user).where(eq(schema.user.id, fixture.workspace.adminUser.id));
      const [current] = await db
        .select()
        .from(schema.githubInstallation)
        .where(eq(schema.githubInstallation.id, fixture.original.id));
      const [integration] = await db
        .select()
        .from(schema.integration)
        .where(eq(schema.integration.id, fixture.original.integrationId));
      const [watch] = await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
      expect(current?.id).toBe(connected.id);
      expect(current?.installationId).toBe(kind === 'same-ID' ? fixture.oldId : fixture.newId);
      expect(integration?.id).toBe(fixture.original.integrationId);
      expect(integrationBefore?.connectedById).toBe(administrator.id);
      expect(integration?.connectedById).toBe(administrator.id);
      expect(watch?.id).toBe(fixture.watch.id);
    });
  }
});
