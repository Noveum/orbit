import { and, db, eq, lt, or, schema, sql } from '@orbit/db';
import { resolveIssueUnfurls, sendSlackUnfurls, verifySlackSignature } from '@orbit/services';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { slackEventSchema } from '@orbit/shared/validators';
import {
  slackIntegrationEnabledForOrganization,
  slackIntegrationUnavailable,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';
import { scheduleSlackEventProcessing } from '@/lib/integrations/slack-event-scheduler.ts';

const SIGNATURE_HEADER = 'x-slack-signature';
const TIMESTAMP_HEADER = 'x-slack-request-timestamp';
export const maxDuration = 60;
const SLACK_EVENT_CLAIM_TIMEOUT_MS = (maxDuration + 15) * 1000;

export async function POST(request: Request): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  const signingSecret = process.env['SLACK_SIGNING_SECRET'] ?? '';
  const raw = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? '';

  if (!verifySlackSignature(raw, timestamp, signature, signingSecret)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = slackEventSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: true });

  const event = parsed.data;
  if (event.type === 'url_verification') {
    return Response.json({ challenge: event.challenge });
  }

  if (event.event.type === 'link_shared') {
    const claim = await claimSlackEvent(event.event_id, event.event.type);
    if (claim instanceof Response) return claim;
    scheduleSlackEventProcessing(
      async () =>
        await processLinkShared(
          event.event_id,
          claim.claimedAt,
          event.team_id,
          event.event.channel,
          event.event.message_ts,
          event.event.links,
        ),
    );
    return Response.json({ ok: true });
  }
  return Response.json({ ok: true });
}

interface SlackEventClaim {
  readonly claimedAt: Date;
}

async function claimSlackEvent(
  deliveryId: string,
  eventName: string,
): Promise<SlackEventClaim | Response> {
  const claimedAt = new Date();
  const claimed = await db
    .insert(schema.webhookDelivery)
    .values({
      id: randomUUIDv7(),
      provider: 'slack',
      deliveryId,
      event: eventName,
      status: 'processing',
      claimedAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookDelivery.id });
  if (claimed.length === 1) return { claimedAt };
  const reclaimed = await db
    .update(schema.webhookDelivery)
    .set({ status: 'processing', event: eventName, error: null, claimedAt })
    .where(
      and(
        deliveryMatch(deliveryId),
        or(
          eq(schema.webhookDelivery.status, 'failed'),
          and(
            eq(schema.webhookDelivery.status, 'processing'),
            lt(
              schema.webhookDelivery.claimedAt,
              new Date(claimedAt.getTime() - SLACK_EVENT_CLAIM_TIMEOUT_MS),
            ),
          ),
        ),
      ),
    )
    .returning({ id: schema.webhookDelivery.id });
  if (reclaimed.length === 1) return { claimedAt };
  return Response.json({ ok: true });
}

async function processLinkShared(
  deliveryId: string,
  claimedAt: Date,
  slackTeamId: string,
  channel: string | undefined,
  ts: string | undefined,
  links: readonly { url: string }[] | undefined,
): Promise<void> {
  try {
    const organizationId = await unfurlLinks(slackTeamId, channel, ts, links);
    await db
      .update(schema.webhookDelivery)
      .set({
        status: 'processed',
        error: null,
        ...(organizationId === null ? {} : { organizationId }),
      })
      .where(deliveryClaimMatch(deliveryId, claimedAt));
  } catch {
    try {
      await db
        .update(schema.webhookDelivery)
        .set({ status: 'failed', error: 'Slack unfurl processing failed.' })
        .where(deliveryClaimMatch(deliveryId, claimedAt));
    } catch {
      console.error('[orbit] slack unfurl failure finalization failed');
    }
    console.error('[orbit] slack unfurl processing failed');
  }
}

function deliveryClaimMatch(deliveryId: string, claimedAt: Date) {
  return and(
    deliveryMatch(deliveryId),
    eq(schema.webhookDelivery.status, 'processing'),
    eq(schema.webhookDelivery.claimedAt, claimedAt),
  );
}

function deliveryMatch(deliveryId: string) {
  return and(
    eq(schema.webhookDelivery.provider, 'slack'),
    eq(schema.webhookDelivery.deliveryId, deliveryId),
  );
}

async function unfurlLinks(
  slackTeamId: string,
  channel: string | undefined,
  ts: string | undefined,
  links: readonly { url: string }[] | undefined,
): Promise<string | null> {
  if (channel === undefined || ts === undefined || links === undefined || links.length === 0)
    return null;

  const integrationRows = await db
    .select({
      integrationId: schema.integration.id,
      organizationId: schema.integration.organizationId,
      externalId: schema.integration.externalId,
    })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.provider, 'slack'),
        or(
          sql`${schema.integration.config} ->> 'slackTeamId' = ${slackTeamId}`,
          and(
            eq(schema.integration.externalId, slackTeamId),
            sql`not (${schema.integration.config} ? 'slackTeamId')`,
          ),
        ),
      ),
    )
    .limit(2);
  const integrationRow = integrationRows[0];
  if (integrationRows.length !== 1 || integrationRow === undefined) {
    console.warn('[orbit] slack webhook team routing failed');
    return null;
  }
  if (!slackIntegrationEnabledForOrganization(integrationRow.organizationId)) return null;

  const mappings = await db
    .select({ teamId: schema.slackChannelSync.teamId })
    .from(schema.slackChannelSync)
    .where(
      and(
        eq(schema.slackChannelSync.organizationId, integrationRow.organizationId),
        eq(schema.slackChannelSync.integrationId, integrationRow.integrationId),
        eq(schema.slackChannelSync.channelId, channel),
        eq(schema.slackChannelSync.enabled, true),
      ),
    )
    .limit(2);
  const mapping = mappings[0];
  if (mappings.length !== 1 || mapping === undefined) return integrationRow.organizationId;

  const unfurls = await resolveIssueUnfurls(
    db,
    integrationRow.organizationId,
    links.map((link) => link.url),
    mapping.teamId ?? undefined,
  );
  if (Object.keys(unfurls).length === 0) return integrationRow.organizationId;

  await sendSlackUnfurls(db, {
    organizationId: integrationRow.organizationId,
    externalId: integrationRow.externalId,
    channel,
    ts,
    unfurls,
  });
  return integrationRow.organizationId;
}
