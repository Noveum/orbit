import { describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { reconcileWatchedRepositories } from '@orbit/services';
import {
  awaitReplacementBarrier,
  createReplacementFixture,
  observeReplacement,
} from './github-replacement-fixture.ts';
import { pauseReplacementDistinctRead } from './github-replacement-read-barrier.ts';

describe('replacement boundary captured watched reconciliation', () => {
  it('does not restore a retired installation ID from a previously completed desired-watch read', async () => {
    const fixture = await createReplacementFixture();
    const barrier = pauseReplacementDistinctRead(
      db,
      (query) =>
        query.sql.includes('from "github_repository_link"') &&
        query.sql.includes('join "github_installation"') &&
        query.params.includes(fixture.workspace.organizationId),
    );
    const work = observeReplacement(
      reconcileWatchedRepositories(db, fixture.workspace.organizationId),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      expect(barrier.hits).toBe(1);
      await fixture.adopt();
      const [before] = await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
      expect(before?.installationId).toBe(fixture.newId);
      barrier.release();
      await work;
      const [after] = await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
      expect(after?.installationId).toBe(fixture.newId);
      expect(after?.integrationId).toBe(fixture.original.integrationId);
      expect(after?.repositoryName).toBe(before?.repositoryName);
    } finally {
      barrier.restore();
      await work;
    }
  });
});
