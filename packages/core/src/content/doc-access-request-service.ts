import { and, asc, db, eq, schema } from '@orbit/db';
import type { NotificationEvent } from '@orbit/services/notifications';
import { conflict, forbidden } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { docUrl } from '@orbit/shared/utils';
import { docAccessDecisionSchema, docAccessRequestSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { notifyRecipients } from '../notifications/notify.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import type { DocRow } from './doc-service.ts';
import { DOC_COLUMNS, docReadableBy } from './doc-service.ts';

export type DocAccessRequestRow = typeof schema.docAccessRequest.$inferSelect;

export interface DocGateway {
  readonly id: string;
  readonly title: string;
  readonly ownerName: string;
  readonly requested: boolean;
}

export interface SavedDocAccessRequest {
  readonly request: DocAccessRequestRow;
  readonly actions: SyncAction[];
}

async function loadDocForRequest(
  executor: Executor,
  principal: Principal,
  docId: string,
): Promise<DocRow> {
  const [row] = await executor
    .select(DOC_COLUMNS)
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, principal.organizationId)))
    .limit(1);
  return requireRow(row, 'That doc does not exist.');
}

export async function docGateway(principal: Principal, docId: string): Promise<DocGateway> {
  assertCan(principal, 'doc:read');
  const doc = await loadDocForRequest(db, principal, docId);
  if (await docReadableBy(db, principal, doc)) throw conflict('You can already read that doc.');

  const [owner] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, doc.authorId))
    .limit(1);

  const [pending] = await db
    .select({ id: schema.docAccessRequest.id })
    .from(schema.docAccessRequest)
    .where(
      and(
        eq(schema.docAccessRequest.docId, docId),
        eq(schema.docAccessRequest.requesterId, principal.userId),
        eq(schema.docAccessRequest.status, 'pending'),
      ),
    )
    .limit(1);

  return {
    id: doc.id,
    title: doc.title,
    ownerName: owner?.name ?? 'the owner',
    requested: pending !== undefined,
  };
}

export async function requestDocAccess(
  principal: Principal,
  docId: string,
  input: unknown = {},
): Promise<SavedDocAccessRequest> {
  assertCan(principal, 'doc:read');
  const parsed = docAccessRequestSchema.parse(input);

  return await db.transaction(async (tx) => {
    const doc = await loadDocForRequest(tx, principal, docId);
    if (await docReadableBy(tx, principal, doc)) throw conflict('You can already read that doc.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.docAccessRequest)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        docId,
        requesterId: principal.userId,
        message: parsed.message ?? null,
        status: 'pending',
        syncId,
      })
      .onConflictDoNothing()
      .returning();

    if (created === undefined) throw conflict('You have already asked for access to that doc.');

    const events: NotificationEvent[] = [
      {
        organizationId: doc.organizationId,
        type: 'doc_access_requested',
        reason: 'access_requested',
        actor,
        entityType: 'doc',
        entityId: doc.id,
        userIds: [doc.authorId],
        title: `Asked to read ${doc.title}`,
        body: parsed.message ?? '',
        url: docUrl(doc.id),
      },
    ];

    return { request: created, actions: await notifyRecipients(tx, events) };
  });
}

export async function listDocAccessRequests(
  principal: Principal,
  docId: string,
): Promise<DocAccessRequestRow[]> {
  assertCan(principal, 'doc:read');
  const doc = await loadDocForRequest(db, principal, docId);
  if (principal.role !== 'admin' && doc.authorId !== principal.userId) {
    throw forbidden('Only the author or an admin can see who asked for access.');
  }
  return await db
    .select()
    .from(schema.docAccessRequest)
    .where(
      and(eq(schema.docAccessRequest.docId, docId), eq(schema.docAccessRequest.status, 'pending')),
    )
    .orderBy(asc(schema.docAccessRequest.createdAt));
}

export async function decideDocAccessRequest(
  principal: Principal,
  requestId: string,
  input: unknown,
): Promise<SavedDocAccessRequest> {
  assertCan(principal, 'doc:write');
  const { grant, level } = docAccessDecisionSchema.parse(input);

  return await db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(schema.docAccessRequest)
      .where(
        and(
          eq(schema.docAccessRequest.id, requestId),
          eq(schema.docAccessRequest.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const request = requireRow(pending, 'That request does not exist.');
    if (request.status !== 'pending') throw conflict('That request was already answered.');

    const doc = await loadDocForRequest(tx, principal, request.docId);
    if (principal.role !== 'admin' && doc.authorId !== principal.userId) {
      throw forbidden('Only the author or an admin can answer a request for access.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    if (grant) {
      await tx
        .insert(schema.docAccess)
        .values({
          id: newId(),
          organizationId: principal.organizationId,
          docId: request.docId,
          subjectType: 'user',
          subjectId: request.requesterId,
          level,
          grantedById: principal.userId,
          syncId,
        })
        .onConflictDoUpdate({
          target: [
            schema.docAccess.docId,
            schema.docAccess.subjectType,
            schema.docAccess.subjectId,
          ],
          set: { level, grantedById: principal.userId, syncId },
        });
    }

    const [saved] = await tx
      .update(schema.docAccessRequest)
      .set({
        status: grant ? 'granted' : 'declined',
        decidedById: principal.userId,
        decidedAt: new Date(),
        syncId,
      })
      .where(eq(schema.docAccessRequest.id, requestId))
      .returning();
    const decided = requireRow(saved, 'That request does not exist.');

    if (!grant) return { request: decided, actions: [] };

    const notifications = await notifyRecipients(tx, [
      {
        organizationId: doc.organizationId,
        type: 'doc_access_granted',
        reason: 'access_granted',
        actor,
        entityType: 'doc',
        entityId: doc.id,
        userIds: [request.requesterId],
        title: `You can now read ${doc.title}`,
        body: '',
        url: docUrl(doc.id),
      },
    ]);

    return {
      request: decided,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: doc.organizationId,
          scopes: [scopes.user(request.requesterId), scopes.doc(doc.id)],
          action: 'update',
          model: 'doc',
          modelId: doc.id,
          data: { id: doc.id, title: doc.title },
          actor,
        }),
        ...notifications,
      ],
    };
  });
}
