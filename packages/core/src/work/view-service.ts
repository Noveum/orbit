import { and, asc, db, eq, inArray, or, type SQL, schema, sql } from '@orbit/db';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { ViewState, ViewVisibility, VirtualViewId } from '@orbit/shared/filters';
import {
  isVirtualViewId,
  VIEW_VISIBILITIES,
  VIRTUAL_VIEW_IDS,
  VIRTUAL_VIEW_NAMES,
  viewStateFrom,
  virtualViewState,
} from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, canReadView, teamScope } from '@orbit/shared/policy';
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

function visibilityOf(row: ViewRow): ViewVisibility {
  return VIEW_VISIBILITIES.find((entry) => entry === row.visibility) ?? 'private';
}

interface AudienceColumns {
  readonly visibility: ViewVisibility;
  readonly teamId: string | null;
  readonly shared: string;
}

function audienceColumns(state: ViewState): AudienceColumns {
  const visibility = state.visibility;
  return {
    visibility,
    teamId: visibility === 'team' ? state.teamId : null,
    shared: String(visibility !== 'private'),
  };
}

async function assertAudienceReachable(principal: Principal, state: ViewState): Promise<void> {
  if (state.visibility !== 'team') return;
  const teamId = state.teamId;
  if (teamId === null) {
    throw validationFailed('Pick the team that can see this view.');
  }
  const [row] = await db
    .select({ id: schema.team.id, organizationId: schema.team.organizationId })
    .from(schema.team)
    .where(eq(schema.team.id, teamId))
    .limit(1);
  const team = requireRow(row, 'That team does not exist.');
  assertInTeam(principal, teamScope({ teamId: team.id, organizationId: team.organizationId }));
}

export function viewScopes(row: ViewRow): string[] {
  const visibility = visibilityOf(row);
  if (visibility === 'workspace') {
    return [scopes.organization(row.organizationId), scopes.user(row.ownerId)];
  }
  if (visibility === 'team' && row.teamId !== null) {
    return [scopes.team(row.teamId), scopes.user(row.ownerId)];
  }
  return [scopes.user(row.ownerId)];
}

export function viewReadFilter(principal: Principal): SQL {
  const mine = eq(schema.view.ownerId, principal.userId);
  const everyone = eq(schema.view.visibility, 'workspace');
  const clause = or(mine, everyone, teamVisibleFilter(principal));
  return clause ?? sql`false`;
}

function teamVisibleFilter(principal: Principal): SQL {
  const isTeamView = eq(schema.view.visibility, 'team');
  if (principal.role === 'admin') return isTeamView;
  if (principal.teamIds.length === 0) return sql`false`;
  const clause = and(isTeamView, inArray(schema.view.teamId, [...principal.teamIds]));
  return clause ?? sql`false`;
}

function toRecord(row: ViewRow, favorite: boolean): ViewRecord {
  const stored = viewStateFrom(row.filter, row.layout === 'board' ? 'board' : 'list');
  const state: ViewState = { ...stored, visibility: visibilityOf(row) };
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    state,
    layout: row.layout,
    groupBy: row.groupBy,
    shared: state.visibility !== 'private',
    virtual: false,
    locked: state.locked,
    favorite,
    createdAt: row.createdAt,
  };
}

function virtualRecord(id: VirtualViewId, principal: Principal): ViewRecord {
  const state = virtualViewState(id, principal.userId);
  return {
    id,
    ownerId: principal.userId,
    name: VIRTUAL_VIEW_NAMES[id],
    state,
    layout: state.layout,
    groupBy: state.groupBy,
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
  await assertAudienceReachable(principal, parsed.filter);

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
        ...audienceColumns(parsed.filter),
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
  if (parsed.filter !== undefined) await assertAudienceReachable(principal, parsed.filter);

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.view.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.filter !== undefined) {
      const audience = audienceColumns(parsed.filter);
      values.filter = parsed.filter;
      values.layout = parsed.filter.layout;
      values.groupBy = parsed.filter.groupBy;
      values.visibility = audience.visibility;
      values.teamId = audience.teamId;
      values.shared = audience.shared;
    }

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
        ...narrowedAudienceActions({ syncId, actor, before: current, after: view }),
      ],
    };
  });
}

interface NarrowedAudienceInput {
  readonly syncId: number;
  readonly actor: Awaited<ReturnType<typeof principalActor>>;
  readonly before: ViewRow;
  readonly after: ViewRow;
}

function droppedScopes(before: ViewRow, after: ViewRow): string[] {
  if (visibilityOf(after) === 'workspace') return [];
  const reached = new Set(viewScopes(after));
  return viewScopes(before).filter((scope) => !reached.has(scope));
}

function narrowedAudienceActions(input: NarrowedAudienceInput): SyncAction[] {
  const dropped = droppedScopes(input.before, input.after);
  if (dropped.length === 0) return [];
  return [
    buildSyncAction({
      syncId: input.syncId,
      organizationId: input.after.organizationId,
      scopes: dropped,
      action: 'delete',
      model: 'view',
      modelId: input.after.id,
      data: { id: input.after.id },
      actor: input.actor,
    }),
  ];
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
            eq(schema.favorite.organizationId, principal.organizationId),
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
  if (!canReadView(principal, view)) {
    throw forbidden('That view is not shared with you.');
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
        and(eq(schema.view.organizationId, principal.organizationId), viewReadFilter(principal)),
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
