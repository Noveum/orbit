import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { listGithubCatalogue, listGithubInstallations } from '@orbit/services';
import {
  completeGithubInstall,
  refreshWorkspaceRepositories,
  repositoriesAreStale,
} from '../../../src/features/settings/github-connect.ts';
import type { GithubAppConfig } from '../../../src/lib/env.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CONFIG: GithubAppConfig = {
  slug: 'orbit-noveum-ai',
  appId: '4514311',
  privateKey,
  clientId: 'Iv1.test',
  clientSecret: 'test-secret',
};

const NOVEUM = '151887625';
const IMSHASHANK = '151889033';

interface GithubStub {
  readonly installations: Record<string, unknown>;
  readonly repositories: Record<string, unknown[]>;
  readonly userInstallations?: number[];
  readonly userTokenError?: string;
}

function githubFetch(stub: GithubStub): typeof globalThis.fetch {
  return ((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/login/oauth/access_token')) {
      const body =
        stub.userTokenError === undefined
          ? { access_token: 'ghu_token' }
          : { error: stub.userTokenError };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    if (url.includes('/user/installations')) {
      const ids = stub.userInstallations ?? [];
      return Promise.resolve(
        new Response(
          JSON.stringify({ total_count: ids.length, installations: ids.map((id) => ({ id })) }),
          { status: 200 },
        ),
      );
    }
    if (url.includes('/access_tokens')) {
      expect(init?.method).toBe('POST');
      return Promise.resolve(new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 }));
    }
    if (url.includes('/installation/repositories')) {
      const match = /\/app\/installations\/(\d+)/.exec(url);
      const id = match?.[1] ?? currentInstallation;
      const repositories = stub.repositories[id] ?? [];
      return Promise.resolve(
        new Response(JSON.stringify({ total_count: repositories.length, repositories }), {
          status: 200,
        }),
      );
    }
    const installationMatch = /\/app\/installations\/(\d+)$/.exec(url);
    if (installationMatch !== null) {
      const found = stub.installations[installationMatch[1] ?? ''];
      if (found === undefined) {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(found), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as unknown as typeof globalThis.fetch;
}

let currentInstallation = NOVEUM;

function installationPayload(id: string, login: string, selection: 'all' | 'selected' = 'all') {
  return {
    id: Number(id),
    account: { login, id: 192082188, type: login === 'imshashank' ? 'User' : 'Organization' },
    target_type: login === 'imshashank' ? 'User' : 'Organization',
    repository_selection: selection,
    suspended_at: null,
  };
}

function repositoryPayload(id: number, fullName: string, isPrivate = false) {
  return {
    id,
    name: fullName.slice(fullName.indexOf('/') + 1),
    full_name: fullName,
    private: isPrivate,
    archived: false,
    default_branch: 'main',
    html_url: `https://github.com/${fullName}`,
    owner: { login: fullName.slice(0, fullName.indexOf('/')) },
  };
}

const NOVEUM_STUB: GithubStub = {
  installations: {
    [NOVEUM]: installationPayload(NOVEUM, 'Noveum'),
    [IMSHASHANK]: installationPayload(IMSHASHANK, 'imshashank', 'selected'),
  },
  repositories: {
    [NOVEUM]: [
      repositoryPayload(884762793, 'Noveum/ai-gateway'),
      repositoryPayload(900712888, 'Noveum/magic-experiments', true),
    ],
    [IMSHASHANK]: [repositoryPayload(618961824, 'imshashank/magicapi-next-dash', true)],
  },
  userInstallations: [Number(NOVEUM), Number(IMSHASHANK)],
};

let workspace: Workspace;
let other: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Noveum');
  other = await createWorkspace('Rival');
  currentInstallation = NOVEUM;
});

function install(target: Workspace, installationId: string, stub = NOVEUM_STUB, code = 'the-code') {
  currentInstallation = installationId;
  return completeGithubInstall({
    organizationId: target.organizationId,
    userId: target.adminUser.id,
    installationId,
    config: CONFIG,
    fetch: githubFetch(stub),
    code,
  });
}

describe('completeGithubInstall', () => {
  it('binds the installation to the workspace that started the flow and caches its repositories', async () => {
    const row = await install(workspace, NOVEUM);

    expect(row.organizationId).toBe(workspace.organizationId);
    expect(row.accountLogin).toBe('Noveum');
    expect(row.repositorySelection).toBe('all');

    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName).sort()).toEqual([
      'Noveum/ai-gateway',
      'Noveum/magic-experiments',
    ]);
    expect(catalogue.find((entry) => entry.fullName === 'Noveum/magic-experiments')?.private).toBe(
      true,
    );
  });

  it('refuses to let a second workspace claim the same installation', async () => {
    await install(workspace, NOVEUM);

    await expect(install(other, NOVEUM)).rejects.toThrow(/already connected to another/);

    expect(await listGithubInstallations(db, other.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, other.organizationId)).toHaveLength(0);
  });

  it('keeps the first workspace repositories invisible to the second', async () => {
    await install(workspace, NOVEUM);
    await install(other, IMSHASHANK);

    const theirs = await listGithubCatalogue(db, other.organizationId);
    expect(theirs.map((entry) => entry.fullName)).toEqual(['imshashank/magicapi-next-dash']);
    const ours = await listGithubCatalogue(db, workspace.organizationId);
    expect(ours.every((entry) => entry.accountLogin === 'Noveum')).toBe(true);
  });

  it('lets one workspace hold installations on two different github accounts', async () => {
    await install(workspace, NOVEUM);
    await install(workspace, IMSHASHANK);

    const installations = await listGithubInstallations(db, workspace.organizationId);
    expect(installations.map((row) => row.accountLogin).sort()).toEqual(['Noveum', 'imshashank']);
    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue).toHaveLength(3);
    expect(new Set(catalogue.map((entry) => entry.accountLogin))).toEqual(
      new Set(['Noveum', 'imshashank']),
    );
  });

  it('refuses an installation the signing-in user cannot reach on GitHub', async () => {
    const stub: GithubStub = { ...NOVEUM_STUB, userInstallations: [Number(IMSHASHANK)] };

    await expect(install(workspace, NOVEUM, stub, 'the-code')).rejects.toThrow(
      /do not have access to that GitHub installation/,
    );

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('accepts an installation the signing-in user can reach', async () => {
    const row = await install(workspace, NOVEUM, NOVEUM_STUB, 'the-code');
    expect(row.installationId).toBe(NOVEUM);
  });

  it('refuses an actor demoted after GitHub access verification and before binding', async () => {
    const demotingFetch = ((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/user/installations')) {
        return db
          .update(schema.member)
          .set({ role: 'member' })
          .where(
            and(
              eq(schema.member.organizationId, workspace.organizationId),
              eq(schema.member.userId, workspace.adminUser.id),
            ),
          )
          .then(() => githubFetch(NOVEUM_STUB)(url, init));
      }
      return githubFetch(NOVEUM_STUB)(url, init);
    }) as unknown as typeof globalThis.fetch;

    await expect(
      completeGithubInstall({
        organizationId: workspace.organizationId,
        userId: workspace.adminUser.id,
        installationId: NOVEUM,
        code: 'the-code',
        config: CONFIG,
        fetch: demotingFetch,
      }),
    ).rejects.toThrow(/cannot integration manage/);

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
  });

  it('refuses a workspace marked for deletion after GitHub verification and before binding', async () => {
    const deletingFetch = ((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/user/installations')) {
        return db
          .update(schema.organization)
          .set({ deletionRequestedAt: new Date() })
          .where(eq(schema.organization.id, workspace.organizationId))
          .then(() => githubFetch(NOVEUM_STUB)(url, init));
      }
      return githubFetch(NOVEUM_STUB)(url, init);
    }) as unknown as typeof globalThis.fetch;

    await expect(
      completeGithubInstall({
        organizationId: workspace.organizationId,
        userId: workspace.adminUser.id,
        installationId: NOVEUM,
        code: 'the-code',
        config: CONFIG,
        fetch: deletingFetch,
      }),
    ).rejects.toThrow(/deletion is in progress/);

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
  });

  it('refuses a callback carrying no code, which proves nothing about the caller', async () => {
    await expect(install(workspace, NOVEUM, NOVEUM_STUB, '')).rejects.toThrow(
      /no proof that you control the installation/,
    );

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
  });

  it('refuses when the app has no client credentials rather than skipping the check', async () => {
    await expect(
      completeGithubInstall({
        organizationId: workspace.organizationId,
        userId: workspace.adminUser.id,
        installationId: NOVEUM,
        code: 'the-code',
        config: { ...CONFIG, clientId: '', clientSecret: '' },
        fetch: githubFetch(NOVEUM_STUB),
      }),
    ).rejects.toThrow(/no client credentials/);

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('refuses when GitHub does not know the installation at all', async () => {
    const stub: GithubStub = { ...NOVEUM_STUB, userInstallations: [999999999] };

    await expect(install(workspace, '999999999', stub)).rejects.toThrow(/HTTP 404/);

    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('refuses when the app is not configured rather than binding a blank installation', async () => {
    await expect(
      completeGithubInstall({
        organizationId: workspace.organizationId,
        userId: workspace.adminUser.id,
        installationId: NOVEUM,
        code: 'the-code',
        config: { ...CONFIG, appId: '', privateKey: '' },
        fetch: githubFetch(NOVEUM_STUB),
      }),
    ).rejects.toThrow(/not configured yet/);
  });

  it('reconnects after a disconnect with a fresh repository cache', async () => {
    await install(workspace, NOVEUM);
    await db
      .delete(schema.githubInstallation)
      .where(eq(schema.githubInstallation.organizationId, workspace.organizationId));

    const again = await install(workspace, NOVEUM);

    expect(again.organizationId).toBe(workspace.organizationId);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(2);
  });
});

describe('repositoriesAreStale', () => {
  it('is true when the cache has never been filled', async () => {
    const row = await install(workspace, NOVEUM);
    expect(repositoriesAreStale({ ...row, repositoriesSyncedAt: null })).toBe(true);
  });

  it('is false inside the cache window so a page view does not hammer GitHub', async () => {
    const row = await install(workspace, NOVEUM);
    const synced = new Date('2026-08-07T10:00:00.000Z');
    expect(
      repositoriesAreStale(
        { ...row, repositoriesSyncedAt: synced },
        new Date('2026-08-07T10:05:00.000Z'),
      ),
    ).toBe(false);
  });

  it('is true once the cache window has passed', async () => {
    const row = await install(workspace, NOVEUM);
    const synced = new Date('2026-08-07T10:00:00.000Z');
    expect(
      repositoriesAreStale(
        { ...row, repositoriesSyncedAt: synced },
        new Date('2026-08-07T10:11:00.000Z'),
      ),
    ).toBe(true);
  });

  it('is false for a suspended installation, which cannot be read anyway', async () => {
    const row = await install(workspace, NOVEUM);
    expect(repositoriesAreStale({ ...row, status: 'suspended', repositoriesSyncedAt: null })).toBe(
      false,
    );
  });
});

describe('refreshWorkspaceRepositories', () => {
  it('does not call GitHub again while the cache is fresh', async () => {
    await install(workspace, NOVEUM);
    const installations = await listGithubInstallations(db, workspace.organizationId);
    let calls = 0;
    const counting = ((url: string, init?: RequestInit) => {
      calls += 1;
      return githubFetch(NOVEUM_STUB)(url, init);
    }) as unknown as typeof globalThis.fetch;

    const refreshed = await refreshWorkspaceRepositories({
      installations,
      force: false,
      config: CONFIG,
      fetch: counting,
    });

    expect(refreshed).toBe(0);
    expect(calls).toBe(0);
  });

  it('calls GitHub when forced', async () => {
    await install(workspace, NOVEUM);
    const installations = await listGithubInstallations(db, workspace.organizationId);
    let calls = 0;
    const counting = ((url: string, init?: RequestInit) => {
      calls += 1;
      return githubFetch(NOVEUM_STUB)(url, init);
    }) as unknown as typeof globalThis.fetch;

    const refreshed = await refreshWorkspaceRepositories({
      installations,
      force: true,
      config: CONFIG,
      fetch: counting,
    });

    expect(refreshed).toBe(1);
    expect(calls).toBeGreaterThan(0);
  });

  it('leaves the cache in place when GitHub is unreachable', async () => {
    await install(workspace, NOVEUM);
    const installations = await listGithubInstallations(db, workspace.organizationId);

    const refreshed = await refreshWorkspaceRepositories({
      installations,
      force: true,
      config: CONFIG,
      fetch: (() =>
        Promise.reject(new Error('network down'))) as unknown as typeof globalThis.fetch,
    });

    expect(refreshed).toBe(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(2);
  });

  it('keeps the catalogue when the snapshot would be truncated, rather than pruning to it', async () => {
    await install(workspace, NOVEUM);
    const installations = await listGithubInstallations(db, workspace.organizationId);
    const endless = ((input: string) => {
      const url = String(input);
      if (url.includes('/access_tokens')) {
        return Promise.resolve(new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 }));
      }
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      const start = (page - 1) * 100;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            total_count: 1_000_000,
            repositories: Array.from({ length: 100 }, (_unused, index) => ({
              id: 5_000_000 + start + index,
              full_name: `Noveum/bulk-${start + index}`,
            })),
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof globalThis.fetch;

    const refreshed = await refreshWorkspaceRepositories({
      installations,
      force: true,
      config: CONFIG,
      fetch: endless,
    });

    expect(refreshed).toBe(0);
    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName).sort()).toEqual([
      'Noveum/ai-gateway',
      'Noveum/magic-experiments',
    ]);
  });

  it('skips a suspended installation', async () => {
    await install(workspace, NOVEUM);
    await db
      .update(schema.githubInstallation)
      .set({ status: 'suspended' })
      .where(eq(schema.githubInstallation.organizationId, workspace.organizationId));
    const installations = await listGithubInstallations(db, workspace.organizationId);

    const refreshed = await refreshWorkspaceRepositories({
      installations,
      force: true,
      config: CONFIG,
      fetch: (() =>
        Promise.reject(new Error('should not be called'))) as unknown as typeof globalThis.fetch,
    });

    expect(refreshed).toBe(0);
  });
});
