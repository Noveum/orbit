import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db } from '@orbit/db';
import {
  bindGithubInstallation,
  listGithubCatalogue,
  listGithubInstallations,
} from '@orbit/services';
import { GET } from '../../../../../../src/app/api/integrations/github/callback/route.ts';
import { githubAppConfig } from '../../../../../../src/lib/env.ts';
import {
  integrationStateSecret,
  OAUTH_STATE_TTL_MS,
  signOAuthState,
} from '../../../../../../src/lib/integrations/oauth-state.ts';

const BASE = 'http://localhost:3000/api/integrations/github/callback';
const NOVEUM = '151887625';

const configured = githubAppConfig().appId.length > 0 && githubAppConfig().privateKey.length > 0;

function locationOf(response: Response): string {
  return response.headers.get('location') ?? '';
}

async function callback(params: Record<string, string>): Promise<Response> {
  const url = new URL(BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return await GET(new Request(url.toString()));
}

function validState(workspace: Workspace): string {
  return signOAuthState(
    { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'github' },
    integrationStateSecret(),
  );
}

function payloadFor(workspace: Workspace, provider = 'github', expiresInMs = 60_000): string {
  return Buffer.from(
    JSON.stringify({
      org: workspace.organizationId,
      user: workspace.adminUser.id,
      provider,
      exp: Date.now() + expiresInMs,
      nonce: 'a-nonce',
    }),
  ).toString('base64url');
}

const INSTALLATION_BODY = {
  id: Number(NOVEUM),
  account: { login: 'Noveum', id: 192082188, type: 'Organization' },
  target_type: 'Organization',
  repository_selection: 'all',
  suspended_at: null,
};

const REPOSITORY_BODY = {
  total_count: 1,
  repositories: [
    {
      id: 884762793,
      name: 'ai-gateway',
      full_name: 'Noveum/ai-gateway',
      private: false,
      archived: false,
      default_branch: 'main',
      html_url: 'https://github.com/Noveum/ai-gateway',
      owner: { login: 'Noveum' },
    },
  ],
};

const realFetch = globalThis.fetch;
let githubCalls: string[] = [];
let workspace: Workspace;
let rival: Workspace;

function workingGithub(): typeof globalThis.fetch {
  return ((input: string, init?: RequestInit) => {
    const url = String(input);
    githubCalls.push(url);
    if (url.includes('/login/oauth/access_token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'ghu_token' }), { status: 200 }),
      );
    }
    if (url.includes('/user/installations')) {
      return Promise.resolve(
        new Response(JSON.stringify({ total_count: 1, installations: [{ id: Number(NOVEUM) }] }), {
          status: 200,
        }),
      );
    }
    if (url.includes('/access_tokens')) {
      expect(init?.method).toBe('POST');
      return Promise.resolve(new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 }));
    }
    if (url.includes('/installation/repositories')) {
      return Promise.resolve(new Response(JSON.stringify(REPOSITORY_BODY), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(INSTALLATION_BODY), { status: 200 }));
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Noveum');
  rival = await createWorkspace('Rival');
  githubCalls = [];
  globalThis.fetch = workingGithub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function expectRejectedBeforeGithub(response: Response): Promise<void> {
  expect(response.status).toBe(302);
  expect(locationOf(response)).not.toContain('github=connected');
  expect(githubCalls).toHaveLength(0);
  expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
}

describe('GET /api/integrations/github/callback', () => {
  it('connects the workspace named by the signed state', async () => {
    if (!configured) return;
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      state: validState(workspace),
    });

    expect(locationOf(response)).toContain('github=connected');
    const installations = await listGithubInstallations(db, workspace.organizationId);
    expect(installations).toHaveLength(1);
    expect(installations[0]?.installationId).toBe(NOVEUM);
    expect(installations[0]?.accountLogin).toBe('Noveum');
    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName)).toEqual(['Noveum/ai-gateway']);
  });

  it('connects nobody else, even though GitHub would happily answer', async () => {
    if (!configured) return;
    await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      state: validState(workspace),
    });

    expect(await listGithubInstallations(db, rival.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, rival.organizationId)).toHaveLength(0);
  });

  it('rejects a callback with no state at all', async () => {
    const response = await callback({ installation_id: NOVEUM, setup_action: 'install' });
    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state whose signature is junk', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      state: `${payloadFor(workspace)}.deadbeef`,
    });
    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state signed with a secret that is not ours', async () => {
    const body = payloadFor(workspace);
    const signature = createHmac('sha256', 'not-the-orbit-secret').update(body).digest('base64url');

    const response = await callback({ installation_id: NOVEUM, state: `${body}.${signature}` });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state that has expired', async () => {
    const expired = signOAuthState(
      { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'github' },
      integrationStateSecret(),
      new Date(Date.now() - OAUTH_STATE_TTL_MS - 1000),
    );

    const response = await callback({ installation_id: NOVEUM, state: expired });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state minted for a different provider', async () => {
    const slackState = signOAuthState(
      { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'slack' },
      integrationStateSecret(),
    );

    const response = await callback({ installation_id: NOVEUM, state: slackState });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects an installation id that is not a number', async () => {
    const response = await callback({
      installation_id: '151887625 or 1=1',
      state: validState(workspace),
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('reports a request to install rather than pretending it connected', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'request',
      state: validState(workspace),
    });

    expect(locationOf(response)).toContain('github=denied');
    await expectRejectedBeforeGithub(response);
  });

  it('does not connect when GitHub does not recognise the installation', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('{}', { status: 404 }))) as unknown as typeof globalThis.fetch;

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      state: validState(workspace),
    });

    expect(locationOf(response)).toContain('github=error');
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('never hands one workspace an installation another workspace already holds', async () => {
    await db.transaction(async (tx) =>
      bindGithubInstallation(tx, {
        organizationId: rival.organizationId,
        connectedById: rival.adminUser.id,
        account: {
          installationId: NOVEUM,
          accountLogin: 'Noveum',
          accountId: '192082188',
          accountType: 'Organization',
          repositorySelection: 'all',
          suspended: false,
        },
      }),
    );

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      state: validState(workspace),
    });

    expect(locationOf(response)).not.toContain('github=connected');
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
    const theirs = await listGithubInstallations(db, rival.organizationId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.organizationId).toBe(rival.organizationId);
  });

  it('refuses when the person completing the flow cannot reach that installation', async () => {
    if (!configured) return;
    globalThis.fetch = ((input: string, init?: RequestInit) => {
      const url = String(input);
      githubCalls.push(url);
      if (url.includes('/login/oauth/access_token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'ghu_token' }), { status: 200 }),
        );
      }
      if (url.includes('/user/installations')) {
        return Promise.resolve(
          new Response(JSON.stringify({ total_count: 0, installations: [] }), { status: 200 }),
        );
      }
      return workingGithub()(input, init);
    }) as unknown as typeof globalThis.fetch;

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state: validState(workspace),
    });

    expect(locationOf(response)).toContain('github=denied');
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('always answers with a redirect rather than leaking an error body', async () => {
    const response = await callback({ installation_id: NOVEUM, state: 'nonsense' });
    expect(response.status).toBe(302);
    expect(locationOf(response)).toContain('/settings/integrations');
  });
});
