import { describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { applyGithubInstallationEvent } from '@orbit/services';
import {
  awaitReplacementBarrier,
  createReplacementFixture,
  observeReplacement,
  replacementRepository,
  repositoryPayload,
} from './github-replacement-fixture.ts';
import { pauseReplacementRead } from './github-replacement-read-barrier.ts';

describe('replacement boundary remaining proofs', () => {
  it('does not remove the adopted catalogue after the second old installation lookup completed', async () => {
    const fixture = await createReplacementFixture();
    let matchingReads = 0;
    const barrier = pauseReplacementRead(db, (query) => {
      if (
        !(query.sql.includes('from "github_installation"') && query.params.includes(fixture.oldId))
      )
        return false;
      matchingReads += 1;
      return matchingReads === 2;
    });
    const work = observeReplacement(
      applyGithubInstallationEvent(db, {
        eventName: 'installation_repositories',
        body: {
          action: 'removed',
          installation: { id: Number(fixture.oldId) },
          repositories_removed: [repositoryPayload(replacementRepository())],
        },
      }),
    );
    try {
      await awaitReplacementBarrier(barrier.arrived, work);
      expect(matchingReads).toBe(2);
      await fixture.adopt();
      const before = await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
      barrier.release();
      await work;
      expect(
        await db
          .select()
          .from(schema.githubRepositorySync)
          .where(eq(schema.githubRepositorySync.id, fixture.watch.id)),
      ).toEqual(before);
      const [catalogue] = await db
        .select()
        .from(schema.githubRepository)
        .where(eq(schema.githubRepository.id, fixture.catalogue.id));
      expect(catalogue?.fullName).toBe('fixture-account/renamed');
    } finally {
      barrier.restore();
      await work;
    }
  });

  for (const action of ['renamed', 'deleted'] as const) {
    it(`ignores a ${action} repository event carrying a retired installation ID`, async () => {
      const fixture = await createReplacementFixture();
      await fixture.adopt();
      const beforeWatch = await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
      const beforeCatalogue = await db
        .select()
        .from(schema.githubRepository)
        .where(eq(schema.githubRepository.id, fixture.catalogue.id));
      const beforePull = await db
        .select()
        .from(schema.githubPullRequest)
        .where(eq(schema.githubPullRequest.id, fixture.pullId));
      await applyGithubInstallationEvent(db, {
        eventName: 'repository',
        body: {
          action,
          installation: { id: Number(fixture.oldId) },
          repository: repositoryPayload(replacementRepository('11', 'retired-event')),
        },
      });
      expect(
        await db
          .select()
          .from(schema.githubRepositorySync)
          .where(eq(schema.githubRepositorySync.id, fixture.watch.id)),
      ).toEqual(beforeWatch);
      expect(
        await db
          .select()
          .from(schema.githubRepository)
          .where(eq(schema.githubRepository.id, fixture.catalogue.id)),
      ).toEqual(beforeCatalogue);
      expect(
        await db
          .select()
          .from(schema.githubPullRequest)
          .where(eq(schema.githubPullRequest.id, fixture.pullId)),
      ).toEqual(beforePull);
    });
  }

  for (const scope of ['current-ID', 'absent-ID'] as const) {
    for (const action of ['renamed', 'deleted'] as const) {
      it(`preserves the ${scope} ${action} repository event contract`, async () => {
        const fixture = await createReplacementFixture();
        await fixture.adopt();
        const outcome = await applyGithubInstallationEvent(db, {
          eventName: 'repository',
          body: {
            action,
            ...(scope === 'current-ID' ? { installation: { id: Number(fixture.newId) } } : {}),
            repository: repositoryPayload(replacementRepository('11', 'current-event')),
          },
        });
        expect(outcome.handled).toBe(true);
        const watches = await db
          .select()
          .from(schema.githubRepositorySync)
          .where(eq(schema.githubRepositorySync.id, fixture.watch.id));
        const catalogue = await db
          .select()
          .from(schema.githubRepository)
          .where(eq(schema.githubRepository.id, fixture.catalogue.id));
        if (action === 'deleted') {
          expect(watches).toHaveLength(0);
          expect(catalogue).toHaveLength(0);
        } else {
          expect(watches[0]?.repositoryName).toBe('fixture-account/current-event');
          expect(catalogue[0]?.fullName).toBe('fixture-account/current-event');
        }
      });
    }
  }

  it('preserves repository removal through the current replacement installation', async () => {
    const fixture = await createReplacementFixture();
    await fixture.adopt();
    const outcome = await applyGithubInstallationEvent(db, {
      eventName: 'installation_repositories',
      body: {
        action: 'removed',
        installation: { id: Number(fixture.newId) },
        repositories_removed: [repositoryPayload(replacementRepository())],
      },
    });
    expect(outcome.handled).toBe(true);
    expect(
      await db
        .select()
        .from(schema.githubRepositorySync)
        .where(eq(schema.githubRepositorySync.id, fixture.watch.id)),
    ).toHaveLength(0);
  });
});
