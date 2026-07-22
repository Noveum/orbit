import { and, asc, db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { labelCreateSchema, labelUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, pickProvided, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type LabelRow = typeof schema.label.$inferSelect;

export const STARTER_LABELS: readonly { name: string; color: string }[] = [
  { name: 'Bug', color: '#EF4444' },
  { name: 'Feature', color: '#22C55E' },
  { name: 'Improvement', color: '#3B82F6' },
  { name: 'Design', color: '#EC4899' },
  { name: 'Documentation', color: '#A855F7' },
  { name: 'Chore', color: '#6B7280' },
];

function labelScopes(row: LabelRow): string[] {
  const list = [scopes.organization(row.organizationId)];
  if (row.teamId !== null) list.push(scopes.team(row.teamId));
  return list;
}

export async function createStarterLabels(
  executor: Executor,
  params: { organizationId: string; syncId: number },
): Promise<LabelRow[]> {
  return await executor
    .insert(schema.label)
    .values(
      STARTER_LABELS.map((entry) => ({
        id: newId(),
        organizationId: params.organizationId,
        teamId: null,
        name: entry.name,
        color: entry.color,
        syncId: params.syncId,
      })),
    )
    .returning();
}

export async function listLabels(
  principal: Principal,
  options: { teamId?: string } = {},
): Promise<LabelRow[]> {
  assertCan(principal, 'issue:read');
  const rows = await db
    .select()
    .from(schema.label)
    .where(eq(schema.label.organizationId, principal.organizationId))
    .orderBy(asc(schema.label.name));
  if (options.teamId === undefined) return rows;
  return rows.filter((row) => row.teamId === null || row.teamId === options.teamId);
}

export async function getLabel(principal: Principal, labelId: string): Promise<LabelRow> {
  assertCan(principal, 'issue:read');
  const [row] = await db
    .select()
    .from(schema.label)
    .where(
      and(eq(schema.label.id, labelId), eq(schema.label.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(row, 'That label does not exist.');
}

export async function createLabel(
  principal: Principal,
  input: unknown,
): Promise<{ label: LabelRow; actions: SyncAction[] }> {
  assertCan(principal, 'label:manage');
  const parsed = labelCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.label)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        teamId: parsed.teamId,
        name: parsed.name,
        color: parsed.color,
        syncId,
      })
      .returning();
    const row = requireRow(created, 'The label could not be created.');
    return {
      label: row,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: labelScopes(row),
          action: 'insert',
          model: 'label',
          modelId: row.id,
          data: row,
          actor,
        }),
      ],
    };
  });
}

export async function updateLabel(
  principal: Principal,
  labelId: string,
  input: unknown,
): Promise<{ label: LabelRow; actions: SyncAction[] }> {
  assertCan(principal, 'label:manage');
  const parsed = pickProvided(input, labelUpdateSchema.parse(input));

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.label.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.color !== undefined) values.color = parsed.color;
    if (parsed.teamId !== undefined) values.teamId = parsed.teamId;

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.label)
      .set({ ...values, syncId })
      .where(
        and(
          eq(schema.label.id, labelId),
          eq(schema.label.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const row = requireRow(updated, 'That label does not exist.');
    return {
      label: row,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: labelScopes(row),
          action: 'update',
          model: 'label',
          modelId: row.id,
          data: row,
          actor,
        }),
      ],
    };
  });
}

export async function deleteLabel(principal: Principal, labelId: string): Promise<SyncAction[]> {
  assertCan(principal, 'label:manage');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.label)
      .where(
        and(
          eq(schema.label.id, labelId),
          eq(schema.label.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const row = requireRow(existing, 'That label does not exist.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.delete(schema.label).where(eq(schema.label.id, labelId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: labelScopes(row),
        action: 'delete',
        model: 'label',
        modelId: labelId,
        data: { id: labelId },
        actor,
      }),
    ];
  });
}
