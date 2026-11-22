import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db } from '@orbit/db';
import { GET as github } from '../../../../src/app/api/integrations/github/callback/route.ts';
import { GET as slack } from '../../../../src/app/api/integrations/slack/callback/route.ts';
import { integrationStateSecret } from '../../../../src/lib/integrations/oauth-state.ts';
import { issueOAuthState } from '../../../../src/lib/integrations/oauth-state-store.ts';

const env = {
  SLACK_ENABLED: 'true',
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: 'test-key',
  GITHUB_APP_CLIENT_ID: 'test-client',
  GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
};
const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let workspace: Workspace;

beforeEach(async () => {
  Object.assign(process.env, env);
  globalThis.fetch = Object.assign(
    () => Promise.reject(new Error('Unexpected provider request')),
    originalFetch,
  );
  await resetDatabase();
  workspace = await createWorkspace('callback-logging');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe.serial('integration callback logging', () => {
  for (const [provider, handler] of [
    ['github', github],
    ['slack', slack],
  ] as const) {
    async function callbackRequest() {
      const state = await issueOAuthState(
        { provider, user: workspace.adminUser.id, org: workspace.organizationId },
        integrationStateSecret(),
      );
      const url = new URL(`http://localhost:3000/api/integrations/${provider}/callback`);
      url.searchParams.set('state', state);
      url.searchParams.set('code', 'synthetic-code');
      url.searchParams.set('installation_id', '12345');
      return new Request(url);
    }

    it(`keeps opaque ${provider} provider errors out of the callback log`, async () => {
      const request = await callbackRequest();
      const failure = Object.assign(new Error('opaque-fixture-value'), {
        cause: new Error('another-opaque-fixture'),
        request: { headers: { authorization: 'synthetic-credential' } },
      });
      globalThis.fetch = Object.assign(() => Promise.reject(failure), originalFetch);
      using log = spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await handler(request);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain(`${provider}=error`);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[1]).toEqual({ error: 'Integration request failed.' });
    });

    it(`keeps ${provider} state lookup parameters out of framework errors`, async () => {
      const request = await callbackRequest();
      const failure = Object.assign(new Error('Failed query: fixture SQL with opaque parameters'), {
        code: '28P01',
        params: ['synthetic-nonce'],
      });
      const methods: Pick<typeof db, 'delete'> = Object.getPrototypeOf(db);
      using remove = spyOn(methods, 'delete').mockImplementation(() => {
        throw failure;
      });
      await expect(handler(request)).rejects.toMatchObject({
        message: 'Database query failed.',
        name: 'DatabaseError',
        code: '28P01',
      });
      expect(remove).toHaveBeenCalledTimes(1);
    });
  }
});
