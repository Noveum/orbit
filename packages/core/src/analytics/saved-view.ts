import { and, asc, db, eq, isNull, or, schema } from '@orbit/db';
import { forbidden } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { principalActor } from '../activity/activity-service.ts';
import { newId, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { cycleBurndown } from './burndown.ts';
import {
  type CheckpointCreate,
  checkpointCreateSchema,
  type SavedAnalyticsViewCreate,
  type SavedAnalyticsViewUpdate,
  savedAnalyticsViewCreateSchema,
  savedAnalyticsViewUpdateSchema,
} from './schemas.ts';

export type SavedAnalyticsViewRow = typeof schema.savedAnalyticsView.$inferSelect;

export type SavedAnalyticsViewPayload = {
  readonly id: string;
  readonly name: string;
  readonly scopeType: string;
  readonly scopeId: string | null;
  readonly kind: string;
  readonly config: Record<string, unknown>;
  readonly shared: boolean;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

function kindOf(config: Record<string, unknown>): string {
  const kind = config['kind'];
  return typeof kind === 'string' ? kind : 'dashboard';
}

export function toSavedAnalyticsViewPayload(row: SavedAnalyticsViewRow): SavedAnalyticsViewPayload {
  return {
    id: row.id,
    name: row.name,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    kind: kindOf(row.config),
    config: row.config,
    shared: row.shared,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function viewScopes(row: SavedAnalyticsViewRow): string[] {
  return [scopes.organization(row.organizationId), scopes.user(row.ownerId)];
}

export async function listSavedAnalyticsViews(
  principal: Principal,
): Promise<SavedAnalyticsViewRow[]> {
  assertCan(principal, 'project:read');
  return await db
    .select()
    .from(schema.savedAnalyticsView)
    .where(
      and(
        eq(schema.savedAnalyticsView.organizationId, principal.organizationId),
        isNull(schema.savedAnalyticsView.archivedAt),
        or(
          eq(schema.savedAnalyticsView.ownerId, principal.userId),
          eq(schema.savedAnalyticsView.shared, true),
        ),
      ),
    )
    .orderBy(asc(schema.savedAnalyticsView.name));
}

async function loadOwnedView(principal: Principal, id: string): Promise<SavedAnalyticsViewRow> {
  const [row] = await db
    .select()
    .from(schema.savedAnalyticsView)
    .where(
      and(
        eq(schema.savedAnalyticsView.id, id),
        eq(schema.savedAnalyticsView.organizationId, principal.organizationId),
        isNull(schema.savedAnalyticsView.archivedAt),
      ),
    )
    .limit(1);
  const view = requireRow(row, 'That analytics view does not exist.');
  if (view.ownerId !== principal.userId && principal.role !== 'admin') {
    throw forbidden('Only the owner can change that analytics view.');
  }
  return view;
}

async function insertView(
  principal: Principal,
  values: {
    name: string;
    scopeType: string;
    scopeId: string | null;
    config: Record<string, unknown>;
    shared: boolean;
  },
): Promise<{ view: SavedAnalyticsViewRow; actions: SyncAction[] }> {
  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.savedAnalyticsView)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        ownerId: principal.userId,
        name: values.name,
        scopeType: values.scopeType,
        scopeId: values.scopeId,
        config: values.config,
        shared: values.shared,
        syncId,
      })
      .returning();
    const view = requireRow(created, 'The analytics view could not be created.');
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
          data: toSavedAnalyticsViewPayload(view),
          actor,
        }),
      ],
    };
  });
}

export async function createSavedAnalyticsView(
  principal: Principal,
  input: unknown,
): Promise<{ view: SavedAnalyticsViewRow; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed: SavedAnalyticsViewCreate = savedAnalyticsViewCreateSchema.parse(input);
  return await insertView(principal, {
    name: parsed.name,
    scopeType: parsed.scopeType,
    scopeId: parsed.scopeId,
    config: { ...parsed.config, kind: kindOf(parsed.config) },
    shared: parsed.shared,
  });
}

export async function updateSavedAnalyticsView(
  principal: Principal,
  id: string,
  input: unknown,
): Promise<{ view: SavedAnalyticsViewRow; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed: SavedAnalyticsViewUpdate = savedAnalyticsViewUpdateSchema.parse(input);
  await loadOwnedView(principal, id);

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.savedAnalyticsView.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.config !== undefined)
      values.config = { ...parsed.config, kind: kindOf(parsed.config) };
    if (parsed.shared !== undefined) values.shared = parsed.shared;

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.savedAnalyticsView)
      .set({ ...values, syncId })
      .where(eq(schema.savedAnalyticsView.id, id))
      .returning();
    const view = requireRow(updated, 'That analytics view does not exist.');
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
          data: toSavedAnalyticsViewPayload(view),
          actor,
        }),
      ],
    };
  });
}

export async function deleteSavedAnalyticsView(
  principal: Principal,
  id: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'view:manage');
  const view = await loadOwnedView(principal, id);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .update(schema.savedAnalyticsView)
      .set({ archivedAt: new Date(), syncId })
      .where(eq(schema.savedAnalyticsView.id, id));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: viewScopes(view),
        action: 'delete',
        model: 'view',
        modelId: id,
        data: { id },
        actor,
      }),
    ];
  });
}

export interface CheckpointView {
  readonly id: string;
  readonly cycleId: string;
  readonly label: string;
  readonly capturedOn: string;
  readonly scope: number;
  readonly completed: number;
  readonly remaining: number;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function toCheckpointView(row: SavedAnalyticsViewRow): CheckpointView {
  const config = row.config;
  return {
    id: row.id,
    cycleId: row.scopeId ?? '',
    label: row.name,
    capturedOn: typeof config['capturedOn'] === 'string' ? config['capturedOn'] : '',
    scope: toNumber(config['scope']),
    completed: toNumber(config['completed']),
    remaining: toNumber(config['remaining']),
  };
}

export async function listCheckpoints(
  principal: Principal,
  cycleId: string,
): Promise<CheckpointView[]> {
  assertCan(principal, 'project:read');
  const rows = await db
    .select()
    .from(schema.savedAnalyticsView)
    .where(
      and(
        eq(schema.savedAnalyticsView.organizationId, principal.organizationId),
        eq(schema.savedAnalyticsView.scopeType, 'cycle'),
        eq(schema.savedAnalyticsView.scopeId, cycleId),
        isNull(schema.savedAnalyticsView.archivedAt),
      ),
    )
    .orderBy(asc(schema.savedAnalyticsView.createdAt));
  return rows.filter((row) => kindOf(row.config) === 'checkpoint').map(toCheckpointView);
}

export async function createCheckpoint(
  principal: Principal,
  input: unknown,
  now: Date = new Date(),
): Promise<{ view: SavedAnalyticsViewRow; actions: SyncAction[] }> {
  assertCan(principal, 'view:manage');
  const parsed: CheckpointCreate = checkpointCreateSchema.parse(input);
  const burndown = await cycleBurndown(principal, parsed.cycleId, 'issues', now);
  const scope = burndown.scopeCurrent;
  const completed = burndown.completedCurrent;

  return await insertView(principal, {
    name: parsed.label,
    scopeType: 'cycle',
    scopeId: parsed.cycleId,
    shared: true,
    config: {
      kind: 'checkpoint',
      cycleId: parsed.cycleId,
      capturedOn: now.toISOString().slice(0, 10),
      scope,
      completed,
      remaining: Math.max(0, scope - completed),
    },
  });
}
