import { db } from '@orbit/db';
import {
  assertSlackIntegrationManager,
  ensureSlackIntegrationWithVersion,
  syncSlackUserMappings,
} from '@orbit/services/slack/dispatch';
import { internal } from '@orbit/shared/errors';
import { z } from 'zod';
import { slackIntegrationEnabledForOrganization } from '@/lib/integrations/slack-capability.ts';

const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_REQUEST_TIMEOUT_MS = 10_000;

const oauthAccessSchema = z.object({
  ok: z.boolean(),
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
  team: z.object({ id: z.string().trim().min(1), name: z.string().default('') }).optional(),
  authed_user: z.object({ id: z.string().optional() }).optional(),
  scope: z.string().optional(),
});

export async function completeSlackInstall(input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  if (!slackIntegrationEnabledForOrganization(input.organizationId)) {
    throw internal('Slack installation is unavailable.');
  }
  await assertSlackIntegrationManager(db, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(SLACK_OAUTH_ACCESS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw internal(`Slack OAuth exchange returned HTTP ${response.status}.`);

  const parsed = oauthAccessSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw internal('Slack OAuth exchange returned an unexpected payload.');
  if (!parsed.data.ok || parsed.data.access_token === undefined) {
    throw internal(`Slack OAuth exchange failed: ${parsed.data.error ?? 'unknown_error'}.`);
  }
  if (parsed.data.team === undefined) {
    throw internal('Slack OAuth exchange returned an unexpected payload.');
  }
  const accessToken = parsed.data.access_token;
  const slackTeamId = parsed.data.team.id;

  const grantedScopes = (parsed.data.scope ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  await db.transaction(async (tx) => {
    return await ensureSlackIntegrationWithVersion(tx, {
      organizationId: input.organizationId,
      connectedById: input.userId,
      botToken: accessToken,
      externalId: slackTeamId,
      scopes: grantedScopes,
    });
  });
  await syncSlackUserMappings(db, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
}
