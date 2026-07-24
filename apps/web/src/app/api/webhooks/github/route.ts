import { and, db, eq, schema } from '@orbit/db';
import { applyGithubEvent, dispatchSlackMessage, verifyGithubSignature } from '@orbit/services';
import { notifyMany } from '@orbit/services/notifications';
import type { SyncAction } from '@orbit/shared/events';
import { randomUUIDv7 } from 'bun';
import { publish } from '@/lib/api/handler.ts';
import { absoluteUrl } from '@/lib/env.ts';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['GITHUB_WEBHOOK_SECRET'] ?? '';
  const raw = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);
  const eventName = request.headers.get(EVENT_HEADER) ?? '';
  const deliveryId = request.headers.get(DELIVERY_HEADER) ?? '';

  if (!verifyGithubSignature(raw, signature, secret)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  if (deliveryId.length === 0) {
    return Response.json({ error: 'missing delivery id' }, { status: 400 });
  }

  const claimed = await db
    .insert(schema.webhookDelivery)
    .values({
      id: randomUUIDv7(),
      provider: 'github',
      deliveryId,
      event: eventName,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookDelivery.id });
  if (claimed.length === 0) {
    const [existing] = await db
      .select({ status: schema.webhookDelivery.status })
      .from(schema.webhookDelivery)
      .where(deliveryMatch(deliveryId))
      .limit(1);
    if (existing === undefined || existing.status === 'processed') {
      return Response.json({ status: 'duplicate' });
    }
    await db
      .update(schema.webhookDelivery)
      .set({ status: 'received', event: eventName })
      .where(deliveryMatch(deliveryId));
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    await db
      .update(schema.webhookDelivery)
      .set({ status: 'failed' })
      .where(deliveryMatch(deliveryId));
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const applied = await applyGithubEvent(tx, { eventName, body });
      const notified = await notifyMany(tx, applied.notificationEvents);
      const actions: SyncAction[] = [...applied.actions, ...notified.actions];
      return {
        organizationId: applied.organizationId,
        teamIds: applied.teamIds,
        actions,
        slackText: applied.notificationEvents[0]?.title ?? null,
      };
    });

    await publish(outcome.actions);

    if (outcome.organizationId !== null && outcome.slackText !== null) {
      await dispatchSlackMessage(db, {
        organizationId: outcome.organizationId,
        teamIds: outcome.teamIds,
        text: `${outcome.slackText}: ${absoluteUrl('/inbox')}`,
      });
    }

    await db
      .update(schema.webhookDelivery)
      .set({ status: 'processed' })
      .where(deliveryMatch(deliveryId));
    return Response.json({ ok: true, actions: outcome.actions.length });
  } catch (error) {
    await db
      .update(schema.webhookDelivery)
      .set({ status: 'failed' })
      .where(deliveryMatch(deliveryId));
    console.error('[orbit] github webhook failed', error);
    return Response.json({ error: 'processing failed' }, { status: 500 });
  }
}

function deliveryMatch(deliveryId: string) {
  return and(
    eq(schema.webhookDelivery.provider, 'github'),
    eq(schema.webhookDelivery.deliveryId, deliveryId),
  );
}
