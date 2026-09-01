import { and, db, eq, inArray, lt, or, schema } from '@orbit/db';
import {
  applyGithubEvent,
  applyGithubInstallationEvent,
  findGithubInstallationAnywhere,
  handlesGithubEvent,
  isGithubInstallationEvent,
  verifyGithubSignature,
} from '@orbit/services';
import { notifyMany } from '@orbit/services/notifications';
import type { SyncAction } from '@orbit/shared/events';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';
import { publish } from '@/lib/api/handler.ts';
import { slackIntegrationEnabledForOrganization } from '@/lib/integrations/slack-capability.ts';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';
export const maxDuration = 60;
const DELIVERY_CLAIM_TIMEOUT_MS = (maxDuration + 15) * 1000;

export type WebhookClaim = {
  readonly id: string;
  readonly claimToken: string;
};

type WebhookFinalization = {
  readonly status: 'failed' | 'ignored' | 'processed';
  readonly error: string | null;
};

type WebhookDeliveryWriter = Pick<typeof db, 'update'>;

export async function claimDelivery(
  deliveryId: string,
  eventName: string,
): Promise<Response | WebhookClaim> {
  const claimedAt = new Date();
  const claimToken = randomUUIDv7();
  const claimed = await db
    .insert(schema.webhookDelivery)
    .values({
      id: randomUUIDv7(),
      provider: 'github',
      deliveryId,
      event: eventName,
      status: 'processing',
      claimToken,
      claimedAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookDelivery.id, claimToken: schema.webhookDelivery.claimToken });
  const created = claimed[0];
  if (created !== undefined && created.claimToken !== null) {
    return { id: created.id, claimToken: created.claimToken };
  }

  const reclaimed = await db
    .update(schema.webhookDelivery)
    .set({ status: 'processing', event: eventName, claimToken, claimedAt })
    .where(
      and(
        deliveryMatch(deliveryId),
        or(
          inArray(schema.webhookDelivery.status, ['received', 'failed']),
          and(
            eq(schema.webhookDelivery.status, 'processing'),
            lt(
              schema.webhookDelivery.claimedAt,
              new Date(claimedAt.getTime() - DELIVERY_CLAIM_TIMEOUT_MS),
            ),
          ),
        ),
      ),
    )
    .returning({ id: schema.webhookDelivery.id, claimToken: schema.webhookDelivery.claimToken });
  const reclaimedDelivery = reclaimed[0];
  if (reclaimedDelivery !== undefined && reclaimedDelivery.claimToken !== null) {
    return { id: reclaimedDelivery.id, claimToken: reclaimedDelivery.claimToken };
  }

  const [current] = await db
    .select({ status: schema.webhookDelivery.status })
    .from(schema.webhookDelivery)
    .where(deliveryMatch(deliveryId))
    .limit(1);
  return current?.status === 'processing'
    ? Response.json({ status: 'in_progress' }, { status: 409 })
    : Response.json({ status: 'duplicate' });
}

export async function finalizeDelivery(
  claim: WebhookClaim,
  finalization: WebhookFinalization,
  database: WebhookDeliveryWriter = db,
): Promise<boolean> {
  const finalized = await database
    .update(schema.webhookDelivery)
    .set(finalization)
    .where(deliveryOwnershipMatch(claim))
    .returning({ id: schema.webhookDelivery.id });
  return finalized.length > 0;
}

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
  if (!handlesGithubEvent(eventName)) {
    return Response.json({ status: 'unhandled', event: eventName });
  }

  const claim = await claimDelivery(deliveryId, eventName);
  if (claim instanceof Response) return claim;

  let body: unknown;
  let deliveryFinalized = false;
  try {
    body = JSON.parse(raw);
  } catch {
    await finalizeDelivery(claim, { status: 'failed', error: null });
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const organizationId = await workspaceBehind(body);
  if (organizationId !== null) {
    await db
      .update(schema.webhookDelivery)
      .set({ organizationId })
      .where(deliveryOwnershipMatch(claim));
  }

  if (isGithubInstallationEvent(eventName)) {
    return await handleInstallationEvent({ eventName, body, claim });
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const applied = await applyGithubEvent(tx, { eventName, body, organizationId });
      const slackEnabled =
        applied.organizationId !== null &&
        slackIntegrationEnabledForOrganization(applied.organizationId);
      const notified = await notifyMany(tx, applied.notificationEvents, {
        slackEnabled,
        sourceDeliveryId: deliveryId,
      });
      const actions: SyncAction[] = [...applied.actions, ...notified.actions];
      requireDeliveryOwnership(
        await finalizeDelivery(claim, outcomeFinalization(applied.ignoredReason), tx),
      );
      return {
        actions,
        ignoredReason: applied.ignoredReason,
      };
    });

    deliveryFinalized = true;
    await publish(outcome.actions);

    return Response.json({
      ok: true,
      actions: outcome.actions.length,
      ...(outcome.ignoredReason === null ? {} : { ignored: outcome.ignoredReason }),
    });
  } catch (error) {
    if (!deliveryFinalized) {
      await finalizeDelivery(claim, { status: 'failed', error: null });
    }
    console.error('[orbit] github webhook failed', error);
    return Response.json({ error: 'processing failed' }, { status: 500 });
  }
}

async function handleInstallationEvent(input: {
  readonly eventName: string;
  readonly body: unknown;
  readonly claim: WebhookClaim;
}): Promise<Response> {
  try {
    const outcome = await db.transaction(async (tx) => {
      const applied = await applyGithubInstallationEvent(tx, {
        eventName: input.eventName,
        body: input.body,
      });
      requireDeliveryOwnership(
        await finalizeDelivery(input.claim, { status: 'processed', error: null }, tx),
      );
      return applied;
    });
    return Response.json({ ok: true, handled: outcome.handled });
  } catch (error) {
    await finalizeDelivery(input.claim, { status: 'failed', error: null });
    console.error('[orbit] github installation webhook failed', error);
    return Response.json({ error: 'processing failed' }, { status: 500 });
  }
}

const installationRefSchema = z.object({
  installation: z.object({ id: z.union([z.number(), z.string()]) }),
});

async function workspaceBehind(body: unknown): Promise<string | null> {
  const parsed = installationRefSchema.safeParse(body);
  if (!parsed.success) return null;
  const installation = await findGithubInstallationAnywhere(
    db,
    String(parsed.data.installation.id),
  );
  return installation?.organizationId ?? null;
}

function deliveryMatch(deliveryId: string) {
  return and(
    eq(schema.webhookDelivery.provider, 'github'),
    eq(schema.webhookDelivery.deliveryId, deliveryId),
  );
}

function deliveryOwnershipMatch(claim: WebhookClaim) {
  return and(
    eq(schema.webhookDelivery.id, claim.id),
    eq(schema.webhookDelivery.status, 'processing'),
    eq(schema.webhookDelivery.claimToken, claim.claimToken),
  );
}

function outcomeFinalization(ignoredReason: string | null): WebhookFinalization {
  return ignoredReason === null
    ? { status: 'processed', error: null }
    : { status: 'ignored', error: ignoredReason };
}

function requireDeliveryOwnership(finalized: boolean): void {
  if (!finalized) throw new Error('GitHub webhook delivery ownership was lost.');
}
