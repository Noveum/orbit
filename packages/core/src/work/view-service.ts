import { and, asc, db, eq, or, schema } from '@orbit/db';
import { forbidden } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { viewCreateSchema, viewUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { newId, pickProvided, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type ViewRow = typeof schema.view.$inferSelect;

function viewScopes(row: ViewRow): string[] {
  return [scopes.organization(row.organizationId), scopes.user(row.ownerId)];
}

export async function createView(
  principal: Principal,
  input: unknown,
): Promise<{ view: ViewRow; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed = viewCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.view)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        ownerId: principal.userId,
        name: parsed.name,
        filter: parsed.filter,
        layout: parsed.layout,
        groupBy: parsed.groupBy,
        shared: String(parsed.shared),
        syncId,
      })
      .returning();
    const view = requireRow(created, 'The view could not be created.');
    return {
      view,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: viewScopes(view),
          action: 'insert',
          model: 'view',
          modelId: view.id,
          data: view,
          actor,
        }),
      ],
    };
  });
}

async function loadOwnedView(principal: Principal, viewId: string): Promise<ViewRow> {
  const [row] = await db
    .select()
    .from(schema.view)
    .where(
      and(eq(schema.view.id, viewId), eq(schema.view.organizationId, principal.organizationId)),
    )
    .limit(1);
  const view = requireRow(row, 'That view does not exist.');
  if (view.ownerId !== principal.userId && principal.role !== 'admin') {
    throw forbidden('Only the owner can change that view.');
  }
  return view;
}

export async function updateView(
  principal: Principal,
  viewId: string,
  input: unknown,
): Promise<{ view: ViewRow; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed = pickProvided(input, viewUpdateSchema.parse(input));
  await loadOwnedView(principal, viewId);

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.view.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.filter !== undefined) values.filter = parsed.filter;
    if (parsed.layout !== undefined) values.layout = parsed.layout;
    if (parsed.groupBy !== undefined) values.groupBy = parsed.groupBy;
    if (parsed.shared !== undefined) values.shared = String(parsed.shared);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.view)
      .set({ ...values, syncId })
      .where(eq(schema.view.id, viewId))
      .returning();
    const view = requireRow(updated, 'That view does not exist.');
    return {
      view,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: viewScopes(view),
          action: 'update',
          model: 'view',
          modelId: view.id,
          data: view,
          actor,
        }),
      ],
    };
  });
}

export async function deleteView(principal: Principal, viewId: string): Promise<SyncAction[]> {
  assertCan(principal, 'view:manage');
  const view = await loadOwnedView(principal, viewId);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.delete(schema.view).where(eq(schema.view.id, viewId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: viewScopes(view),
        action: 'delete',
        model: 'view',
        modelId: viewId,
        data: { id: viewId },
        actor,
      }),
    ];
  });
}

export async function listViews(principal: Principal): Promise<ViewRow[]> {
  assertCan(principal, 'issue:read');
  return await db
    .select()
    .from(schema.view)
    .where(
      and(
        eq(schema.view.organizationId, principal.organizationId),
        or(eq(schema.view.ownerId, principal.userId), eq(schema.view.shared, 'true')),
      ),
    )
    .orderBy(asc(schema.view.name));
}

export async function getView(principal: Principal, viewId: string): Promise<ViewRow> {
  assertCan(principal, 'issue:read');
  const [row] = await db
    .select()
    .from(schema.view)
    .where(
      and(eq(schema.view.id, viewId), eq(schema.view.organizationId, principal.organizationId)),
    )
    .limit(1);
  const view = requireRow(row, 'That view does not exist.');
  if (view.ownerId !== principal.userId && view.shared !== 'true') {
    throw forbidden('That view is private.');
  }
  return view;
}
