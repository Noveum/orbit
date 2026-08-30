import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Workspace } from '@orbit/core/test-support';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSlackOrganizationId = process.env['SLACK_ENABLED_ORGANIZATION_ID'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-settings-route-test-secret';

const { addMember, createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const { and, db, eq, schema } = await import('@orbit/db');
const { connectSlackChannel, ensureSlackIntegration } = await import('@orbit/services');
const { mockSession } = await import('../../../../../tests-support.ts');

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

const responseSchema = z.object({
  connected: z.boolean(),
  hasToken: z.boolean(),
  channels: z.array(
    z.object({
      channelId: z.string(),
      channelName: z.string(),
      teamId: z.string().nullable(),
      enabled: z.boolean(),
    }),
  ),
});
const legacyChannelsSchema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isPrivate: z.boolean(),
      isArchived: z.boolean(),
      isMember: z.boolean(),
    }),
  ),
});

let session: Session | null = null;
let workspace: Workspace;

mockSession(() => session);

const { GET, PATCH, POST } = await import('../../../../../src/app/api/integrations/slack/route.ts');

function signIn(user: Workspace['adminUser']): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('SlackSettings');
  process.env['SLACK_ENABLED_ORGANIZATION_ID'] = workspace.organizationId;
  const integrationId = await ensureSlackIntegration(db, {
    organizationId: workspace.organizationId,
    connectedById: workspace.adminUser.id,
    botToken: 'xoxb-workspace-secret',
    externalId: 'T-WORKSPACE',
  });
  await connectSlackChannel(db, {
    organizationId: workspace.organizationId,
    integrationId,
    channelId: 'C-PRIVATE',
    channelName: 'private-roadmap',
    teamId: workspace.teamId,
  });
});

beforeEach(() => {
  signIn(workspace.adminUser);
});

afterAll(() => {
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSlackOrganizationId === undefined)
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];
  else process.env['SLACK_ENABLED_ORGANIZATION_ID'] = existingSlackOrganizationId;
});

describe('GET /api/integrations/slack', () => {
  it('gives an admin the Slack integration state', async () => {
    const response = await GET();
    const payload = responseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      connected: true,
      hasToken: true,
      channels: [
        {
          channelId: 'C-PRIVATE',
          channelName: 'private-roadmap',
          teamId: workspace.teamId,
          enabled: true,
        },
      ],
    });
  });

  it('rejects raw bot-token installation', async () => {
    const response = await POST(
      new Request('https://orbit.test/api/integrations/slack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'install', botToken: 'xoxb-raw-token' }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('xoxb-raw-token');
    const [saved] = await db
      .select({ credentials: schema.integration.credentials })
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(JSON.stringify(saved?.credentials)).not.toContain('xoxb-raw-token');
  });

  it('offers only joined channels through the legacy channel listing', async () => {
    const realFetch = globalThis.fetch;
    const slackFetch = Object.assign(
      async (..._args: Parameters<typeof globalThis.fetch>) =>
        Response.json({
          ok: true,
          channels: [
            { id: 'C-JOINED', name: 'engineering', is_private: false, is_member: true },
            { id: 'C-UNJOINED', name: 'announcements', is_private: false, is_member: false },
          ],
        }),
      { preconnect: realFetch.preconnect },
    ) satisfies typeof globalThis.fetch;
    globalThis.fetch = slackFetch;

    try {
      const response = await PATCH();
      const payload = legacyChannelsSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(payload.channels).toEqual([
        {
          id: 'C-JOINED',
          name: 'engineering',
          isPrivate: false,
          isArchived: false,
          isMember: true,
        },
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('persists Slack canonical channel metadata from the organization integration', async () => {
    const realFetch = globalThis.fetch;
    const authorizations: (string | null)[] = [];
    globalThis.fetch = Object.assign(
      (...args: Parameters<typeof globalThis.fetch>): Promise<Response> => {
        const request = new Request(...args);
        authorizations.push(request.headers.get('authorization'));
        return Promise.resolve(
          Response.json({
            ok: true,
            channel: {
              id: 'C-CANONICAL',
              name: 'canonical-name',
              is_private: false,
              is_archived: false,
              is_member: true,
            },
          }),
        );
      },
      { preconnect: realFetch.preconnect },
    );

    try {
      const response = await POST(
        new Request('https://orbit.test/api/integrations/slack', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'connect',
            integrationId: 'int_client_controlled',
            channelId: 'C-REQUESTED',
            channelName: 'client-controlled-name',
            teamId: null,
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ connected: 'C-CANONICAL' });
      expect(authorizations).toEqual(['Bearer xoxb-workspace-secret']);
      const [mapping] = await db
        .select({
          channelId: schema.slackChannelSync.channelId,
          channelName: schema.slackChannelSync.channelName,
        })
        .from(schema.slackChannelSync)
        .where(eq(schema.slackChannelSync.channelId, 'C-CANONICAL'));
      expect(mapping).toEqual({ channelId: 'C-CANONICAL', channelName: 'canonical-name' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects a channel the bot has not joined without persisting it', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          ok: true,
          channel: {
            id: 'C-NOT-JOINED',
            name: 'not-joined',
            is_private: false,
            is_archived: false,
            is_member: false,
          },
        }),
      { preconnect: realFetch.preconnect },
    );

    try {
      const response = await POST(
        new Request('https://orbit.test/api/integrations/slack', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'connect', channelId: 'C-NOT-JOINED', teamId: null }),
        }),
      );

      expect(response.status).toBe(422);
      const mappings = await db
        .select({ id: schema.slackChannelSync.id })
        .from(schema.slackChannelSync)
        .where(eq(schema.slackChannelSync.channelId, 'C-NOT-JOINED'));
      expect(mappings).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('does not borrow a Slack token from another organization', async () => {
    const other = await createWorkspace('OtherSlackSettings');
    await ensureSlackIntegration(db, {
      organizationId: other.organizationId,
      connectedById: other.adminUser.id,
      botToken: 'xoxb-other-secret',
      externalId: 'T-OTHER-SETTINGS',
    });
    const [current] = await db
      .select({ id: schema.integration.id, credentials: schema.integration.credentials })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, workspace.organizationId),
          eq(schema.integration.provider, 'slack'),
          eq(schema.integration.externalId, 'default'),
        ),
      );
    if (current === undefined) throw new Error('The Slack integration fixture is missing.');
    await db
      .update(schema.integration)
      .set({ credentials: {} })
      .where(eq(schema.integration.id, current.id));
    const realFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = Object.assign(
      (): Promise<Response> => {
        providerCalls += 1;
        return Promise.resolve(Response.json({ ok: false, error: 'unexpected_call' }));
      },
      { preconnect: realFetch.preconnect },
    );

    try {
      const response = await POST(
        new Request('https://orbit.test/api/integrations/slack', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'connect', channelId: 'C-NO-TOKEN', teamId: null }),
        }),
      );

      expect(response.status).toBe(422);
      expect(providerCalls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      await db
        .update(schema.integration)
        .set({ credentials: current.credentials })
        .where(eq(schema.integration.id, current.id));
    }
  });

  for (const role of ['guest', 'contributor', 'member'] as const) {
    it(`withholds Slack integration state from a ${role}`, async () => {
      const { user } = await addMember(workspace, role, { name: `${role} Slack viewer` });
      signIn(user);

      const response = await GET();
      const body = await response.text();

      expect(response.status).toBe(403);
      expect(body).not.toContain('private-roadmap');
      expect(body).not.toContain('C-PRIVATE');
    });
  }

  it('does not expose channels from a coexisting legacy Slack row', async () => {
    const legacyIntegrationId = `int_${randomUUIDv7()}`;
    await db.insert(schema.integration).values({
      id: legacyIntegrationId,
      organizationId: workspace.organizationId,
      provider: 'slack',
      externalId: 'T-LEGACY',
      connectedById: workspace.adminUser.id,
      credentials: { botToken: 'xoxb-legacy' },
    });
    await connectSlackChannel(db, {
      organizationId: workspace.organizationId,
      integrationId: legacyIntegrationId,
      channelId: 'C-LEGACY',
      channelName: 'legacy-private',
      teamId: workspace.teamId,
    });

    const response = await GET();
    const payload = responseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.channels.map((channel) => channel.channelId)).toEqual(['C-PRIVATE']);
  });
});
