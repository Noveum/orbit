import { describe, expect, it } from 'bun:test';
import { githubRepositorySync } from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import { linkGithubRepository, unlinkGithubRepository } from '../../src/github/associations.ts';
import {
  bindGithubInstallation,
  replaceGithubRepositories,
} from '../../src/github/installations.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';
import { account, repository, seedProject, seedWorkspace, type TestWorkspace } from './fixtures.ts';

const NOVEUM = '151887625';

async function connect(tx: TestTransaction, workspace: TestWorkspace, ids: readonly string[]) {
  const installation = await bindGithubInstallation(tx, {
    organizationId: workspace.organizationId,
    connectedById: workspace.userId,
    account: account({ installationId: NOVEUM }),
  });
  await replaceGithubRepositories(tx, {
    installation,
    repositories: ids.map((id) => repository({ repositoryId: id })),
  });
  return installation;
}

function watchedRows(tx: TestTransaction, organizationId: string) {
  return tx
    .select()
    .from(githubRepositorySync)
    .where(eq(githubRepositorySync.organizationId, organizationId));
}

describe('the watched repository record the pull request pipeline reads', () => {
  it('appears when a repository is associated at workspace level, with no team', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });

      const rows = await watchedRows(tx, workspace.organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.repositoryId).toBe('1');
      expect(rows[0]?.teamId).toBeNull();
      expect(rows[0]?.installationId).toBe(NOVEUM);
      expect(rows[0]?.enabled).toBe(true);
    });
  });

  it('disappears when the last association is removed', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });

      await unlinkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
      });

      expect(await watchedRows(tx, workspace.organizationId)).toHaveLength(0);
    });
  });

  it('survives while any other association remains', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const apollo = await seedProject(tx, workspace, 'Apollo');
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: apollo,
        linkedById: workspace.userId,
      });

      await unlinkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
      });

      expect(await watchedRows(tx, workspace.organizationId)).toHaveLength(1);
    });
  });

  it('never writes one row per association, only one per repository', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const apollo = await seedProject(tx, workspace, 'Apollo');
      const gemini = await seedProject(tx, workspace, 'Gemini');

      for (const projectId of [null, apollo, gemini]) {
        await linkGithubRepository(tx, {
          organizationId: workspace.organizationId,
          repositoryId: '1',
          projectId,
          linkedById: workspace.userId,
        });
      }

      expect(await watchedRows(tx, workspace.organizationId)).toHaveLength(1);
    });
  });

  it('leaves a legacy row for a repository outside the catalogue untouched', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      const installation = await connect(tx, workspace, ['1']);
      await tx.insert(githubRepositorySync).values({
        id: `legacy_${randomUUIDv7()}`,
        organizationId: workspace.organizationId,
        integrationId: installation.integrationId,
        teamId: null,
        repositoryId: 'legacy-999',
        repositoryName: 'acme/legacy',
      });

      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });

      const rows = await watchedRows(tx, workspace.organizationId);
      expect(rows.map((row) => row.repositoryId).sort()).toEqual(['1', 'legacy-999']);
    });
  });
});
