import { and, db, eq } from '@orbit/db';
import { member, user } from '@orbit/db/schema';
import { SlackClient } from '@orbit/services/slack';
import { ensureSlackIntegration, upsertSlackUserMapping } from '@orbit/services/slack/dispatch';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { internal } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { z } from 'zod';

const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_REQUEST_TIMEOUT_MS = 10_000;

const oauthAccessSchema = z.object({
  ok: z.boolean(),
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string().default('') }).optional(),
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
  const accessToken = parsed.data.access_token;

  const grantedScopes = (parsed.data.scope ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const integrationId = await db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
      .limit(1);
    assertCan(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        role: organizationRole(membership?.role),
        teamIds: [],
      },
      'integration:manage',
    );
    return await ensureSlackIntegration(tx, {
      organizationId: input.organizationId,
      connectedById: input.userId,
      botToken: accessToken,
      ...(parsed.data.team?.id === undefined ? {} : { externalId: parsed.data.team.id }),
      scopes: grantedScopes,
    });
  });

  const [orbitUser] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (orbitUser === undefined) return;

  try {
    const slackUser = await new SlackClient({ token: accessToken }).lookupUserByEmail(
      orbitUser.email.trim().toLowerCase(),
    );
    if (slackUser === null) return;
    await upsertSlackUserMapping(db, {
      organizationId: input.organizationId,
      integrationId,
      userId: input.userId,
      slackUserId: slackUser.id,
      slackDisplayName: slackUser.displayName,
    });
  } catch (error) {
    console.error('Could not map the Slack user after installation.', error);
  }
}

function organizationRole(role: string | undefined): OrgRole {
  return ORG_ROLES.find((candidate) => candidate === role) ?? 'guest';
}
