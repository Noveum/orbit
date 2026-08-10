import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

process.env['BETTER_AUTH_SECRET'] = 'disabled-slack-boundary-test-secret';

const {
  GET: getIntegration,
  PATCH: listLegacyChannels,
  POST: mutateIntegration,
} = await import('../../../../../src/app/api/integrations/slack/route.ts');
const { GET: startOAuth } = await import(
  '../../../../../src/app/api/integrations/slack/start/route.ts'
);
const { GET: finishOAuth } = await import(
  '../../../../../src/app/api/integrations/slack/callback/route.ts'
);
const { GET: listChannels } = await import(
  '../../../../../src/app/api/integrations/slack/channels/route.ts'
);
const { POST: receiveWebhook } = await import('../../../../../src/app/api/webhooks/slack/route.ts');

const BASE = 'http://localhost:3000';
const realFetch = globalThis.fetch;
const providerFetch = mock(() => {
  throw new Error('disabled route called a provider');
});

beforeEach(() => {
  providerFetch.mockClear();
  globalThis.fetch = providerFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'not_found' });
}

function requestWithUnreadableBody(url: string): {
  readonly request: Request;
  readonly readBody: ReturnType<typeof mock>;
} {
  const readBody = mock(() => {
    throw new Error('disabled route read the request body');
  });
  const request = new Request(url, { method: 'POST', body: 'untrusted' });
  Object.defineProperty(request, 'text', { value: readBody });
  return { request, readBody };
}

describe('disabled Slack boundary', () => {
  it('denies the integration read, mutation, and legacy channel APIs', async () => {
    const { request, readBody } = requestWithUnreadableBody(`${BASE}/api/integrations/slack`);
    await expectUnavailable(await getIntegration());
    await expectUnavailable(await mutateIntegration(request));
    expect(readBody).not.toHaveBeenCalled();
    await expectUnavailable(await listLegacyChannels());
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('denies OAuth start and callback before reading auth state', async () => {
    await expectUnavailable(await startOAuth());
    await expectUnavailable(
      await finishOAuth(new Request(`${BASE}/api/integrations/slack/callback?code=x&state=y`)),
    );
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('denies channel discovery and webhooks before reading credentials or payloads', async () => {
    const { request, readBody } = requestWithUnreadableBody(`${BASE}/api/webhooks/slack`);
    await expectUnavailable(
      await listChannels(new Request(`${BASE}/api/integrations/slack/channels`)),
    );
    await expectUnavailable(await receiveWebhook(request));
    expect(readBody).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
