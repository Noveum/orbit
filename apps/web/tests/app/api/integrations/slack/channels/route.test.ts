import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Workspace } from '@orbit/core/test-support';
import { z } from 'zod';

const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSlackEnabled = process.env['SLACK_ENABLED'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-channels-route-test-secret';

const { createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { db } = await import('@orbit/db');
const { ensureSlackIntegration } = await import('@orbit/services');
const { mockSession } = await import('../../../../../../tests-support.ts');

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

const responseSchema = z.object({
  channels: z.array(z.object({ channelId: z.string(), channelName: z.string() })),
  nextCursor: z.string().nullable(),
});

const realFetch = globalThis.fetch;
const slackFetch = Object.assign(
  async (..._args: Parameters<typeof globalThis.fetch>) =>
    Response.json({
      ok: true,
      channels: [
        { id: 'C-JOINED', name: 'engineering', is_private: false, is_member: true },
        { id: 'C-UNJOINED', name: 'executive-roadmap', is_private: false, is_member: false },
        { id: 'C-PRIVATE', name: 'incident-room', is_private: true, is_member: true },
      ],
      response_metadata: { next_cursor: '' },
    }),
  { preconnect: realFetch.preconnect },
) satisfies typeof globalThis.fetch;

let session: Session | null = null;
let workspace: Workspace;

mockSession(() => session);

const { GET } = await import('@/app/api/integrations/slack/channels/route.ts');

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('SlackChannels');
  process.env['SLACK_ENABLED'] = 'true';
  await ensureSlackIntegration(db, {
    organizationId: workspace.organizationId,
    connectedById: workspace.adminUser.id,
    botToken: 'xoxb-channel-picker',
    externalId: 'T-CHANNELS',
  });
  session = {
    user: workspace.adminUser,
    session: { activeOrganizationId: workspace.organizationId },
  };
  globalThis.fetch = slackFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = existingSlackEnabled;
});

describe('GET /api/integrations/slack/channels', () => {
  it('offers only channels the Slack app has joined', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/integrations/slack/channels'),
    );
    const payload = responseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      channels: [
        { channelId: 'C-JOINED', channelName: 'engineering' },
        { channelId: 'C-PRIVATE', channelName: 'incident-room' },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(payload)).not.toContain('executive-roadmap');
  });
});
