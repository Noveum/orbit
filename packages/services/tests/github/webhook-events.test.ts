import { describe, expect, it } from 'bun:test';
import { githubRepositorySync } from '@orbit/db/schema';
import { eq } from 'drizzle-orm';
import { linkGithubRepository, listGithubCatalogue } from '../../src/github/associations.ts';
import {
  bindGithubInstallation,
  findGithubInstallation,
  listGithubInstallations,
  replaceGithubRepositories,
} from '../../src/github/installations.ts';
import {
  applyGithubInstallationEvent,
  isGithubInstallationEvent,
} from '../../src/github/webhook-events.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';
import { account, repository, seedWorkspace, type TestWorkspace } from './fixtures.ts';

const NOVEUM = 151887625;

async function connect(tx: TestTransaction, workspace: TestWorkspace, ids: readonly string[]) {
  const installation = await bindGithubInstallation(tx, {
    organizationId: workspace.organizationId,
    connectedById: workspace.userId,
    account: account({ installationId: String(NOVEUM) }),
  });
  await replaceGithubRepositories(tx, {
    installation,
    repositories: ids.map((id) =>
      repository({ repositoryId: id, repositoryName: `Noveum/repo-${id}` }),
    ),
  });
  return installation;
}

function shortRepository(id: number, fullName: string, isPrivate = false) {
  return { id, name: fullName.split('/')[1], full_name: fullName, private: isPrivate };
}

function installationRef(selection: 'all' | 'selected' = 'all') {
  return {
    id: NOVEUM,
    account: { login: 'Noveum', id: 192082188, type: 'Organization' },
    repository_selection: selection,
  };
}

describe('isGithubInstallationEvent', () => {
  it('claims the three events that keep the connection accurate and nothing else', () => {
    expect(isGithubInstallationEvent('installation')).toBe(true);
    expect(isGithubInstallationEvent('installation_repositories')).toBe(true);
    expect(isGithubInstallationEvent('repository')).toBe(true);
    expect(isGithubInstallationEvent('pull_request')).toBe(false);
    expect(isGithubInstallationEvent('check_suite')).toBe(false);
  });
});

describe('installation events', () => {
  it('purges the installation when it is deleted on GitHub', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      const outcome = await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: { action: 'deleted', installation: installationRef() },
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.organizationId).toBe(workspace.organizationId);
      expect(await listGithubInstallations(tx, workspace.organizationId)).toHaveLength(0);
      expect(await listGithubCatalogue(tx, workspace.organizationId)).toHaveLength(0);
    });
  });

  it('answers a redelivered delete without failing', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const body = { action: 'deleted', installation: installationRef() };

      await applyGithubInstallationEvent(tx, { eventName: 'installation', body });
      const second = await applyGithubInstallationEvent(tx, { eventName: 'installation', body });

      expect(second.handled).toBe(false);
      expect(await listGithubInstallations(tx, workspace.organizationId)).toHaveLength(0);
    });
  });

  it('suspends and unsuspends the installation', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const lookup = { organizationId: workspace.organizationId, installationId: String(NOVEUM) };

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: { action: 'suspend', installation: installationRef() },
      });
      expect((await findGithubInstallation(tx, lookup))?.status).toBe('suspended');

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: { action: 'unsuspend', installation: installationRef() },
      });
      expect((await findGithubInstallation(tx, lookup))?.status).toBe('active');
    });
  });

  it('does not bind an installation nobody connected through Orbit', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');

      const outcome = await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: {
          action: 'created',
          installation: installationRef(),
          repositories: [shortRepository(1, 'Noveum/ai-gateway')],
        },
      });

      expect(outcome.handled).toBe(false);
      expect(await listGithubInstallations(tx, workspace.organizationId)).toHaveLength(0);
    });
  });

  it('refreshes the account facts and repository selection on a created replay', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, []);

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: {
          action: 'created',
          installation: {
            ...installationRef('selected'),
            account: {
              login: 'Noveum-New',
              id: 192082188,
              type: 'Organization',
            },
          },
          repositories: [shortRepository(7, 'Noveum/orbit')],
        },
      });

      const row = await findGithubInstallation(tx, {
        organizationId: workspace.organizationId,
        installationId: String(NOVEUM),
      });
      expect(row?.accountLogin).toBe('Noveum-New');
      expect(row?.repositorySelection).toBe('selected');
      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.map((entry) => entry.fullName)).toEqual(['Noveum/orbit']);
    });
  });
});

describe('installation_repositories events', () => {
  it('adds newly granted repositories to the catalogue', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation_repositories',
        body: {
          action: 'added',
          installation: installationRef('selected'),
          repository_selection: 'selected',
          repositories_added: [shortRepository(2, 'Noveum/magic', true)],
          repositories_removed: [],
        },
      });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.map((entry) => entry.fullName).sort()).toEqual([
        'Noveum/magic',
        'Noveum/repo-1',
      ]);
      expect(catalogue.find((entry) => entry.fullName === 'Noveum/magic')?.private).toBe(true);
    });
  });

  it('removes revoked repositories and their associations', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1', '2']);
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '2',
        projectId: null,
        linkedById: workspace.userId,
      });

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation_repositories',
        body: {
          action: 'removed',
          installation: installationRef('selected'),
          repositories_added: [],
          repositories_removed: [shortRepository(2, 'Noveum/repo-2')],
        },
      });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.map((entry) => entry.repositoryId)).toEqual(['1']);
      const watched = await tx
        .select()
        .from(githubRepositorySync)
        .where(eq(githubRepositorySync.organizationId, workspace.organizationId));
      expect(watched).toHaveLength(0);
    });
  });

  it('is a no-op when redelivered', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const body = {
        action: 'added',
        installation: installationRef('selected'),
        repositories_added: [shortRepository(2, 'Noveum/magic')],
        repositories_removed: [],
      };

      await applyGithubInstallationEvent(tx, { eventName: 'installation_repositories', body });
      await applyGithubInstallationEvent(tx, { eventName: 'installation_repositories', body });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue).toHaveLength(2);
    });
  });

  it('records the switch from all repositories to a selected set', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      await applyGithubInstallationEvent(tx, {
        eventName: 'installation_repositories',
        body: {
          action: 'removed',
          installation: installationRef('selected'),
          repository_selection: 'selected',
          repositories_added: [],
          repositories_removed: [],
        },
      });

      const row = await findGithubInstallation(tx, {
        organizationId: workspace.organizationId,
        installationId: String(NOVEUM),
      });
      expect(row?.repositorySelection).toBe('selected');
    });
  });

  it('ignores an installation Orbit does not hold', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      const outcome = await applyGithubInstallationEvent(tx, {
        eventName: 'installation_repositories',
        body: {
          action: 'added',
          installation: { ...installationRef(), id: 999999 },
          repositories_added: [shortRepository(5, 'Someone/else')],
          repositories_removed: [],
        },
      });

      expect(outcome.handled).toBe(false);
      expect(await listGithubCatalogue(tx, workspace.organizationId)).toHaveLength(1);
    });
  });
});

describe('repository events', () => {
  it('follows a rename so the stored name stops being stale', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });

      await applyGithubInstallationEvent(tx, {
        eventName: 'repository',
        body: {
          action: 'renamed',
          repository: {
            id: 1,
            name: 'ai-gateway',
            full_name: 'Noveum/ai-gateway',
            private: false,
            archived: false,
            default_branch: 'main',
            html_url: 'https://github.com/Noveum/ai-gateway',
            owner: { login: 'Noveum' },
          },
          installation: installationRef(),
        },
      });

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.fullName).toBe('Noveum/ai-gateway');
      const [watched] = await tx
        .select()
        .from(githubRepositorySync)
        .where(eq(githubRepositorySync.repositoryId, '1'));
      expect(watched?.repositoryName).toBe('Noveum/ai-gateway');
    });
  });

  it('follows a transfer to a new owner', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      await applyGithubInstallationEvent(tx, {
        eventName: 'repository',
        body: {
          action: 'transferred',
          repository: {
            id: 1,
            name: 'repo-1',
            full_name: 'apimarket/repo-1',
            private: true,
            archived: false,
            default_branch: 'trunk',
            html_url: 'https://github.com/apimarket/repo-1',
            owner: { login: 'apimarket' },
          },
        },
      });

      const [entry] = await listGithubCatalogue(tx, workspace.organizationId);
      expect(entry?.fullName).toBe('apimarket/repo-1');
      expect(entry?.ownerLogin).toBe('apimarket');
      expect(entry?.private).toBe(true);
      expect(entry?.defaultBranch).toBe('trunk');
    });
  });

  it('drops a repository deleted on GitHub, along with its associations', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1', '2']);
      await linkGithubRepository(tx, {
        organizationId: workspace.organizationId,
        repositoryId: '1',
        projectId: null,
        linkedById: workspace.userId,
      });

      await applyGithubInstallationEvent(tx, {
        eventName: 'repository',
        body: {
          action: 'deleted',
          repository: { id: 1, name: 'repo-1', full_name: 'Noveum/repo-1', private: false },
        },
      });

      const catalogue = await listGithubCatalogue(tx, workspace.organizationId);
      expect(catalogue.map((entry) => entry.repositoryId)).toEqual(['2']);
      const watched = await tx
        .select()
        .from(githubRepositorySync)
        .where(eq(githubRepositorySync.organizationId, workspace.organizationId));
      expect(watched).toHaveLength(0);
    });
  });

  it('answers a redelivered delete without failing', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);
      const body = {
        action: 'deleted',
        repository: { id: 1, name: 'repo-1', full_name: 'Noveum/repo-1', private: false },
      };

      await applyGithubInstallationEvent(tx, { eventName: 'repository', body });
      const second = await applyGithubInstallationEvent(tx, { eventName: 'repository', body });

      expect(second.handled).toBe(false);
    });
  });

  it('ignores a repository Orbit has never seen', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      const outcome = await applyGithubInstallationEvent(tx, {
        eventName: 'repository',
        body: {
          action: 'renamed',
          repository: { id: 4242, name: 'x', full_name: 'Someone/x', private: false },
        },
      });

      expect(outcome.handled).toBe(false);
      expect(await listGithubCatalogue(tx, workspace.organizationId)).toHaveLength(1);
    });
  });
});

describe('malformed payloads', () => {
  it('ignores a body that does not match the event shape', async () => {
    await withRollback(async (tx) => {
      const workspace = await seedWorkspace(tx, 'Noveum');
      await connect(tx, workspace, ['1']);

      const outcome = await applyGithubInstallationEvent(tx, {
        eventName: 'installation',
        body: { action: 'deleted' },
      });

      expect(outcome.handled).toBe(false);
      expect(await listGithubInstallations(tx, workspace.organizationId)).toHaveLength(1);
    });
  });
});
