import { and, asc, db, eq, or, schema } from '@orbit/db';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { ViewState, VirtualViewId } from '@orbit/shared/filters';
import {
  isVirtualViewId,
  VIRTUAL_VIEW_IDS,
  VIRTUAL_VIEW_NAMES,
  viewStateFrom,
  virtualViewState,
} from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { viewCreateSchema, viewFavoriteSchema, viewUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { newId, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type ViewRow = typeof schema.view.$inferSelect;

export interface ViewRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly state: ViewState;
  readonly layout: string;
  readonly groupBy: string;
  readonly shared: boolean;
  readonly virtual: boolean;
  readonly locked: boolean;
  readonly favorite: boolean;
  readonly createdAt: Date;
}

const VIEW_FAVORITE_ENTITY = 'view';

function viewScopes(row: ViewRow): string[] {
  return [scopes.organization(row.organizationId), scopes.user(row.ownerId)];
}

function toRecord(row: ViewRow, favorite: boolean): ViewRecord {
  const state = viewStateFrom(row.filter, row.layout === 'board' ? 'board' : 'list');
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    state,
    layout: row.layout,
    groupBy: row.groupBy,
    shared: row.shared === 'true',
    virtual: false,
    locked: state.locked,
    favorite,
    createdAt: row.createdAt,
  };
}

function virtualRecord(id: VirtualViewId, principal: Principal): ViewRecord {
  return {
    id,
    ownerId: principal.userId,
    name: VIRTUAL_VIEW_NAMES[id],
    state: virtualViewState(id, principal.userId),
    layout: 'list',
    groupBy: 'state',
    shared: false,
    virtual: true,
    locked: true,
    favorite: false,
    createdAt: new Date(0),
  };
}

export function virtualViews(principal: Principal): ViewRecord[] {
  return VIRTUAL_VIEW_IDS.map((id) => virtualRecord(id, principal));
}

async function favoriteIds(principal: Principal): Promise<Set<string>> {
  const rows = await db
    .select({ entityId: schema.favorite.entityId })
    .from(schema.favorite)
    .where(
      and(
        eq(schema.favorite.organizationId, principal.organizationId),
        eq(schema.favorite.userId, principal.userId),
        eq(schema.favorite.entityType, VIEW_FAVORITE_ENTITY),
      ),
    );
  return new Set(rows.map((row) => row.entityId));
}

export async function createView(
  principal: Principal,
  input: unknown,
): Promise<{ view: ViewRecord; actions: SyncAction[] }> {
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
        layout: parsed.filter.layout,
        groupBy: parsed.filter.groupBy,
        shared: String(parsed.filter.visibility !== 'private'),
        syncId,
      })
      .returning();
    const view = requireRow(created, 'The view could not be created.');
    return {
      view: toRecord(view, false),
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

function rejectVirtual(viewId: string): void {
  if (isVirtualViewId(viewId)) {
    throw forbidden('Built-in views cannot be edited or deleted.');
  }
}

async function loadOwnedView(principal: Principal, viewId: string): Promise<ViewRow> {
  rejectVirtual(viewId);
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
): Promise<{ view: ViewRecord; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed = viewUpdateSchema.parse(input);
  const current = await loadOwnedView(principal, viewId);
  const currentState = viewStateFrom(current.filter);

  if (currentState.locked && parsed.filter !== undefined && parsed.filter.locked !== false) {
    throw validationFailed('That view is locked. Unlock it before changing what it shows.');
  }

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.view.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.filter !== undefined) {
      values.filter = parsed.filter;
      values.layout = parsed.filter.layout;
      values.groupBy = parsed.filter.groupBy;
      values.shared = String(parsed.filter.visibility !== 'private');
    }
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
      view: toRecord(view, false),
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
  if (viewStateFrom(view.filter).locked) {
    throw validationFailed('That view is locked. Unlock it before deleting it.');
  }

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .delete(schema.favorite)
      .where(
        and(
          eq(schema.favorite.entityType, VIEW_FAVORITE_ENTITY),
          eq(schema.favorite.entityId, viewId),
        ),
      );
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

export async function setViewFavorite(
  principal: Principal,
  viewId: string,
  input: unknown,
): Promise<{ view: ViewRecord; actions: SyncAction[] }> {
  assertCan(principal, 'issue:read');
  rejectVirtual(viewId);
  const parsed = viewFavoriteSchema.parse(input);
  const row = await loadReadableView(principal, viewId);

  return await db.transaction(async (tx) => {
    if (parsed.favorite) {
      await tx
        .insert(schema.favorite)
        .values({
          id: newId(),
          organizationId: principal.organizationId,
          userId: principal.userId,
          entityType: VIEW_FAVORITE_ENTITY,
          entityId: viewId,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(schema.favorite)
        .where(
          and(
            eq(schema.favorite.userId, principal.userId),
            eq(schema.favorite.entityType, VIEW_FAVORITE_ENTITY),
            eq(schema.favorite.entityId, viewId),
          ),
        );
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    return {
      view: toRecord(row, parsed.favorite),
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.user(principal.userId)],
          action: 'update',
          model: 'view',
          modelId: viewId,
          data: { id: viewId, favorite: parsed.favorite },
          actor,
        }),
      ],
    };
  });
}

async function loadReadableView(principal: Principal, viewId: string): Promise<ViewRow> {
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

export async function listViews(principal: Principal): Promise<ViewRecord[]> {
  assertCan(principal, 'issue:read');
  const [rows, favorites] = await Promise.all([
    db
      .select()
      .from(schema.view)
      .where(
        and(
          eq(schema.view.organizationId, principal.organizationId),
          or(eq(schema.view.ownerId, principal.userId), eq(schema.view.shared, 'true')),
        ),
      )
      .orderBy(asc(schema.view.name)),
    favoriteIds(principal),
  ]);

  const saved = rows.map((row) => toRecord(row, favorites.has(row.id)));
  saved.sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    if (left.state.position !== right.state.position) {
      return left.state.position - right.state.position;
    }
    return left.name.localeCompare(right.name);
  });
  return [...virtualViews(principal), ...saved];
}

export async function getView(principal: Principal, viewId: string): Promise<ViewRecord> {
  assertCan(principal, 'issue:read');
  if (isVirtualViewId(viewId)) return virtualRecord(viewId, principal);
  const row = await loadReadableView(principal, viewId);
  const favorites = await favoriteIds(principal);
  return toRecord(row, favorites.has(row.id));
}
