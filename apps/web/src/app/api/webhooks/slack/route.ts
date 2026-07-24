import { and, db, eq, schema } from '@orbit/db';
import {
  resolveIssueUnfurls,
  resolveSlackContext,
  SlackClient,
  verifySlackSignature,
} from '@orbit/services';
import { slackEventSchema } from '@orbit/shared/validators';

const SIGNATURE_HEADER = 'x-slack-signature';
const TIMESTAMP_HEADER = 'x-slack-request-timestamp';

export async function POST(request: Request): Promise<Response> {
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
    await unfurlLinks(
      event.team_id,
      event.event.channel,
      event.event.message_ts,
      event.event.links,
    );
  }
  return Response.json({ ok: true });
}

async function unfurlLinks(
  slackTeamId: string,
  channel: string | undefined,
  ts: string | undefined,
  links: readonly { url: string }[] | undefined,
): Promise<void> {
  if (channel === undefined || ts === undefined || links === undefined || links.length === 0)
    return;

  const [integrationRow] = await db
    .select({ organizationId: schema.integration.organizationId })
    .from(schema.integration)
    .where(
      and(eq(schema.integration.provider, 'slack'), eq(schema.integration.externalId, slackTeamId)),
    )
    .limit(1);
  if (integrationRow === undefined) return;

  const context = await resolveSlackContext(db, integrationRow.organizationId, slackTeamId);
  if (context === null || context.token === null) return;

  const unfurls = await resolveIssueUnfurls(
    db,
    integrationRow.organizationId,
    links.map((link) => link.url),
  );
  if (Object.keys(unfurls).length === 0) return;

  try {
    await new SlackClient({ token: context.token }).unfurl({ channel, ts, unfurls });
  } catch (error) {
    console.error('[orbit] slack unfurl failed', error);
  }
}
