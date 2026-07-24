import { db, schema } from '@orbit/db';
import { ensureSlackIntegration } from '@orbit/services';
import { internal } from '@orbit/shared/errors';
import { randomUUIDv7 } from 'bun';
import { z } from 'zod';

const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_REQUEST_TIMEOUT_MS = 10_000;

export async function persistGithubInstallation(input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly installationId: string;
}): Promise<void> {
  await db
    .insert(schema.integration)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      provider: 'github',
      externalId: input.installationId,
      connectedById: input.userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.integration.organizationId,
        schema.integration.provider,
        schema.integration.externalId,
      ],
      set: { connectedById: input.userId, updatedAt: new Date() },
    });
}

const oauthAccessSchema = z.object({
  ok: z.boolean(),
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string().default('') }).optional(),
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

  await ensureSlackIntegration(db, {
    organizationId: input.organizationId,
    connectedById: input.userId,
    botToken: parsed.data.access_token,
  });
}
