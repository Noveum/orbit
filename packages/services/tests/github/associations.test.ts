import { describe, expect, it } from 'bun:test';
import { githubRepositoryLink, githubRepositorySync } from '@orbit/db/schema';
import { eq } from 'drizzle-orm';
import {
  linkGithubRepository,
  listGithubCatalogue,
  unlinkGithubRepository,
  unlinkGithubRepositoryEverywhere,
} from '../../src/github/associations.ts';
import {
  bindGithubInstallation,
  removeGithubRepositories,
  replaceGithubRepositories,
} from '../../src/github/installations.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';
import { account, repository, seedProject, seedWorkspace, type TestWorkspace } from './fixtures.ts';

const NOVEUM = '151887625';
const API_MARKET = '151889033';

async function connect(
  tx: TestTransaction,
  workspace: TestWorkspace,
  installationId: string,
  repositoryIds: readonly string[],
  login = 'Noveum',
) {
  const installation = await bindGithubInstallation(tx, {
    organizationId: workspace.organizationId,
    connectedById: workspace.userId,
    account: account({ installationId, accountLogin: login }),
  });
  await replaceGithubRepositories(tx, {
    installation,
    repositories: repositoryIds.map((id) =>
      repository({ repositoryId: id, repositoryName: `${login}/repo-${id}` }),
    ),
  });
  return installation;
}

function link(
  tx: TestTransaction,
  workspace: TestWorkspace,
  repositoryId: string,
  projectId: string | null,
) {
  return linkGithubRepository(tx, {
    organizationId: workspace.organizationId,
    repositoryId,
    projectId,
    linkedById: workspace.userId,
  });
}

describe('listGithubCatalogue', () => {
  it('lists every repository across every installation the workspace holds', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1', '2'], 'Noveum');
      await connect(tx, workspace, API_MARKET, ['9'], 'apimarket');

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);

      expect(catalogue.map((entry) => entry.fullName).sort()).toEqual([
        'Noveum/repo-1',
        'Noveum/repo-2',
        'apimarket/repo-9',
      ]);
      expect(catalogue.map((entry) => entry.accountLogin).sort()).toEqual([
        'Noveum',
        'Noveum',
        'apimarket',
      ]);
    });
  });

  it('never shows another workspace repositories', async () => {
    await withRollback(async (tx) => {
      const first = await seedWorkspace(tx, 'First');
      const second = await seedWorkspace(tx, 'Second');
      await connect(tx, first, NOVEUM, ['1'], 'Noveum');
      await connect(tx, second, API_MARKET, ['9'], 'apimarket');

      const catalogue = await listGithubCatalogue(tx, second.organizationId);

      expect(catalogue.map((entry) => entry.fullName)).toEqual(['apimarket/repo-9']);
    });
  });

  it('marks private repositories as private', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      const installation = await bindGithubInstallation(tx, {
        organizationId: workspace.organizationId,
        connectedById: workspace.userId,
        account: account({ installationId: NOVEUM }),
      });
      await replaceGithubRepositories(tx, {
        installation,
        repositories: [
          repository({ repositoryId: '1', repositoryName: 'Noveum/open' }),
          repository({ repositoryId: '2', repositoryName: 'Noveum/secret', private: true }),
        ],
      });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.find((entry) => entry.fullName === 'Noveum/secret')?.private).toBe(true);
      expect(catalogue.find((entry) => entry.fullName === 'Noveum/open')?.private).toBe(false);
    });
  });

  it('drops a repository from the catalogue once it is removed from the installation', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1', '2'], 'Noveum');
      await link(tx, workspace, '2', null);

      await removeGithubRepositories(tx, {
        installationId: NOVEUM,
        repositoryIds: ['2'],
      });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.map((entry) => entry.repositoryId)).toEqual(['1']);
      const watched = await tx
        .select({ repositoryId: githubRepositorySync.repositoryId })
        .from(githubRepositorySync)
        .where(eq(githubRepositorySync.organizationId, workspace.organizationId));
      expect(watched).toHaveLength(0);
    });
  });
});

describe('linkGithubRepository', () => {
  it('lets one project track several repositories', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1', '2'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');

      await link(tx, workspace, '1', apollo);
      await link(tx, workspace, '2', apollo);

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      for (const entry of catalogue) {
        expect(entry.links.map((entry) => entry.projectId)).toEqual([apollo]);
      }
    });
  });

  it('lets one repository serve several projects and the workspace at once', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');
      const gemini = await seedProject(tx, workspace, 'Gemini');

      await link(tx, workspace, '1', apollo);
      await link(tx, workspace, '1', gemini);
      await link(tx, workspace, '1', null);

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links).toHaveLength(3);
      expect(entry?.links.map((row) => row.projectId).sort()).toEqual(
        [apollo, gemini, null].sort(),
      );
    });
  });

  it('names the project on each association so the list is readable', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');
      await link(tx, workspace, '1', apollo);

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links[0]?.projectName).toBe('Apollo');
    });
  });

  it('is idempotent so a double click does not create two identical associations', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');

      const first = await link(tx, workspace, '1', apollo);
      const second = await link(tx, workspace, '1', apollo);

      expect(second.id).toBe(first.id);
      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links).toHaveLength(1);
    });
  });

  it('is idempotent for a workspace level association too', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');

      await link(tx, workspace, '1', null);
      await link(tx, workspace, '1', null);

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links).toHaveLength(1);
      expect(entry?.links[0]?.projectId).toBeNull();
    });
  });

  it('refuses a repository that belongs to another workspace', async () => {
    await withRollback(async (tx) => {
      const first = await seedWorkspace(tx, 'First');
      const second = await seedWorkspace(tx, 'Second');
      await connect(tx, first, NOVEUM, ['1'], 'Noveum');

      await expect(link(tx, second, '1', null)).rejects.toThrow(/not connected to this workspace/);

      const rows = await tx.select().from(githubRepositoryLink);
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses a project that belongs to another workspace', async () => {
    await withRollback(async (tx) => {
      const first = await seedWorkspace(tx, 'First');
      const second = await seedWorkspace(tx, 'Second');
      await connect(tx, first, NOVEUM, ['1'], 'Noveum');
      const foreignProject = await seedProject(tx, second, 'Theirs');

      await expect(link(tx, first, '1', foreignProject)).rejects.toThrow(
        /does not exist in this workspace/,
      );

      const rows = await tx.select().from(githubRepositoryLink);
      expect(rows).toHaveLength(0);
    });
  });
});

describe('unlinkGithubRepository', () => {
  it('removes just the one association and leaves the others alone', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');
      const gemini = await seedProject(tx, workspace, 'Gemini');
      await link(tx, workspace, '1', apollo);
      await link(tx, workspace, '1', gemini);

      const removed = await unlinkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: apollo,
      });

      expect(removed).toBe(true);
      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links.map((row) => row.projectId)).toEqual([gemini]);
    });
  });

  it('removes the workspace level association without touching project ones', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');
      await link(tx, workspace, '1', null);
      await link(tx, workspace, '1', apollo);

      await unlinkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
      });

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links.map((row) => row.projectId)).toEqual([apollo]);
    });
  });

  it('refuses to unlink through another workspace', async () => {
    await withRollback(async (tx) => {
      const first = await seedWorkspace(tx, 'First');
      const second = await seedWorkspace(tx, 'Second');
      await connect(tx, first, NOVEUM, ['1'], 'Noveum');
      await link(tx, first, '1', null);

      await expect(
        unlinkGithubRepository(tx, {
          organizationId: second.organizationId,
          repositoryId: '1',
          projectId: null,
        }),
      ).rejects.toThrow(/not connected to this workspace/);

      const [entry] = await listGithubCatalogue(tx, first.organizationId);
      expect(entry?.links).toHaveLength(1);
    });
  });

  it('re-associating after removing works, which is the flow people repeat most', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');

      await link(tx, workspace, '1', apollo);
      await unlinkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: apollo,
      });
      const again = await link(tx, workspace, '1', apollo);

      expect(again.projectId).toBe(apollo);
      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links).toHaveLength(1);
    });
  });
});

describe('unlinkGithubRepositoryEverywhere', () => {
  it('clears every association a repository has in one action', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, NOVEUM, ['1'], 'Noveum');
      const apollo = await seedProject(tx, workspace, 'Apollo');
      await link(tx, workspace, '1', apollo);
      await link(tx, workspace, '1', null);

      const removed = await unlinkGithubRepositoryEverywhere(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
      });

      expect(removed).toBe(2);
      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.links).toHaveLength(0);
    });
  });
});
