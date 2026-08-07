import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db } from '@orbit/db';
import {
  bindGithubInstallation,
  forgetGithubInstallationTokens,
  listGithubCatalogue,
  listGithubInstallations,
} from '@orbit/services';
import { GET } from '../../../../../../src/app/api/integrations/github/callback/route.ts';
import {
  integrationStateSecret,
  mintOAuthState,
  OAUTH_STATE_TTL_MS,
} from '../../../../../../src/lib/integrations/oauth-state.ts';
import { issueOAuthState } from '../../../../../../src/lib/integrations/oauth-state-store.ts';

const BASE = 'http://localhost:3000/api/integrations/github/callback';
const NOVEUM = '151887625';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP_ENV = {
  GITHUB_APP_SLUG: 'orbit-noveum-ai',
  GITHUB_APP_ID: '4514311',
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'test-secret',
} as const;

const originalAppEnv = new Map<string, string | undefined>(
  Object.keys(APP_ENV).map((key) => [key, process.env[key]]),
);

function restoreAppEnv(): void {
  for (const [key, value] of originalAppEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function locationOf(response: Response): string {
  return response.headers.get('location') ?? '';
}

async function callback(params: Record<string, string>): Promise<Response> {
  const url = new URL(BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return await GET(new Request(url.toString()));
}

async function validState(target: Workspace): Promise<string> {
  return await issueOAuthState(
    { org: target.organizationId, user: target.adminUser.id, provider: 'github' },
    integrationStateSecret(),
  );
}

function payloadFor(target: Workspace, provider = 'github', expiresInMs = 60_000): string {
  return Buffer.from(
    JSON.stringify({
      org: target.organizationId,
      user: target.adminUser.id,
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
      name: 'top-secret-acquisition',
      full_name: 'Noveum/top-secret-acquisition',
      private: true,
      archived: false,
      default_branch: 'main',
      html_url: 'https://github.com/Noveum/top-secret-acquisition',
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
  Object.assign(process.env, APP_ENV);
  await resetDatabase();
  forgetGithubInstallationTokens();
  workspace = await createWorkspace('Noveum');
  rival = await createWorkspace('Rival');
  githubCalls = [];
  globalThis.fetch = workingGithub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  restoreAppEnv();
});

async function expectRejectedBeforeGithub(response: Response): Promise<void> {
  expect(response.status).toBe(302);
  expect(locationOf(response)).not.toContain('github=connected');
  expect(githubCalls).toHaveLength(0);
  expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
}

describe('GET /api/integrations/github/callback', () => {
  it('connects the workspace named by the signed state', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state: await validState(workspace),
    });

    expect(locationOf(response)).toContain('github=connected');
    const installations = await listGithubInstallations(db, workspace.organizationId);
    expect(installations).toHaveLength(1);
    expect(installations[0]?.installationId).toBe(NOVEUM);
    expect(installations[0]?.accountLogin).toBe('Noveum');
    const catalogue = await listGithubCatalogue(db, workspace.organizationId);
    expect(catalogue.map((entry) => entry.fullName)).toEqual(['Noveum/top-secret-acquisition']);
  });

  it('connects nobody else, even though GitHub would happily answer', async () => {
    await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state: await validState(workspace),
    });

    expect(await listGithubInstallations(db, rival.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, rival.organizationId)).toHaveLength(0);
  });

  it('refuses a callback with no code, which is all an attacker has to omit', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      state: await validState(rival),
    });

    expect(locationOf(response)).toContain('github=error');
    expect(githubCalls).toHaveLength(0);
    expect(await listGithubInstallations(db, rival.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, rival.organizationId)).toHaveLength(0);
  });

  it('refuses a callback whose code is blank rather than treating it as absent', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: '   ',
      state: await validState(rival),
    });

    expect(locationOf(response)).toContain('github=error');
    expect(await listGithubInstallations(db, rival.organizationId)).toHaveLength(0);
  });

  it('refuses when the app has no client credentials rather than skipping the check', async () => {
    process.env['GITHUB_APP_CLIENT_ID'] = '';
    process.env['GITHUB_APP_CLIENT_SECRET'] = '';

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state: await validState(rival),
    });

    expect(locationOf(response)).toContain('github=error');
    expect(await listGithubInstallations(db, rival.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, rival.organizationId)).toHaveLength(0);
  });

  it('refuses a state that has already been spent', async () => {
    const state = await validState(workspace);

    const first = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state,
    });
    expect(locationOf(first)).toContain('github=connected');

    const second = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state,
    });
    expect(locationOf(second)).toContain('github=error');

    const third = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state,
    });
    expect(locationOf(third)).toContain('github=error');
  });

  it('refuses a state Orbit never issued, however well it is signed', async () => {
    const unissued = mintOAuthState(
      { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'github' },
      integrationStateSecret(),
    ).token;

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state: unissued,
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a callback with no state at all', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
    });
    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state whose signature is junk', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      code: 'the-code',
      state: `${payloadFor(workspace)}.deadbeef`,
    });
    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state signed with a secret that is not ours', async () => {
    const body = payloadFor(workspace);
    const signature = createHmac('sha256', 'not-the-orbit-secret').update(body).digest('base64url');

    const response = await callback({
      installation_id: NOVEUM,
      code: 'the-code',
      state: `${body}.${signature}`,
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state that has expired', async () => {
    const expired = mintOAuthState(
      { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'github' },
      integrationStateSecret(),
      new Date(Date.now() - OAUTH_STATE_TTL_MS - 1000),
    ).token;

    const response = await callback({
      installation_id: NOVEUM,
      code: 'the-code',
      state: expired,
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects a state minted for a different provider', async () => {
    const slackState = await issueOAuthState(
      { org: workspace.organizationId, user: workspace.adminUser.id, provider: 'slack' },
      integrationStateSecret(),
    );

    const response = await callback({
      installation_id: NOVEUM,
      code: 'the-code',
      state: slackState,
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('rejects an installation id that is not a number', async () => {
    const response = await callback({
      installation_id: '151887625 or 1=1',
      code: 'the-code',
      state: await validState(workspace),
    });

    expect(locationOf(response)).toContain('github=error');
    await expectRejectedBeforeGithub(response);
  });

  it('reports a request to install rather than pretending it connected', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'request',
      state: await validState(workspace),
    });

    expect(locationOf(response)).toContain('github=denied');
    await expectRejectedBeforeGithub(response);
  });

  it('does not connect when GitHub does not recognise the installation', async () => {
    const state = await validState(workspace);
    globalThis.fetch = ((input: string) => {
      const url = String(input);
      if (url.includes('/login/oauth/access_token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'ghu_token' }), { status: 200 }),
        );
      }
      if (url.includes('/user/installations')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ total_count: 1, installations: [{ id: Number(NOVEUM) }] }),
            {
              status: 200,
            },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as unknown as typeof globalThis.fetch;

    const response = await callback({
      installation_id: NOVEUM,
      setup_action: 'install',
      code: 'the-code',
      state,
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
      code: 'the-code',
      state: await validState(workspace),
    });

    expect(locationOf(response)).not.toContain('github=connected');
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
    expect(await listGithubCatalogue(db, workspace.organizationId)).toHaveLength(0);
    const theirs = await listGithubInstallations(db, rival.organizationId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.organizationId).toBe(rival.organizationId);
  });

  it('refuses when the person completing the flow cannot reach that installation', async () => {
    const state = await validState(workspace);
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
      state,
    });

    expect(locationOf(response)).toContain('github=denied');
    expect(await listGithubInstallations(db, workspace.organizationId)).toHaveLength(0);
  });

  it('always answers with a redirect rather than leaking an error body', async () => {
    const response = await callback({
      installation_id: NOVEUM,
      code: 'the-code',
      state: 'nonsense',
    });
    expect(response.status).toBe(302);
    expect(locationOf(response)).toContain('/settings/integrations');
  });
});
