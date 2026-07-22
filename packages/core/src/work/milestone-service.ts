import { and, asc, db, eq, inArray, schema } from '@orbit/db';
import { SORT_ORDER_STEP } from '@orbit/shared/constants';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { milestoneCreateSchema, milestoneUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, pickProvided, requireRow, toDateString } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type MilestoneRow = typeof schema.milestone.$inferSelect;

function milestoneScopes(row: MilestoneRow): string[] {
  return [scopes.organization(row.organizationId), scopes.project(row.projectId)];
}

async function assertProjectInOrganization(
  executor: Executor,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const [row] = await executor
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.organizationId, organizationId)))
    .limit(1);
  requireRow(row, 'That project does not exist.');
}

export async function createMilestone(
  principal: Principal,
  input: unknown,
): Promise<{ milestone: MilestoneRow; actions: SyncAction[] }> {
  assertCan(principal, 'milestone:manage');
  const parsed = milestoneCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    await assertProjectInOrganization(tx, principal.organizationId, parsed.projectId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [last] = await tx
      .select({ sortOrder: schema.milestone.sortOrder })
      .from(schema.milestone)
      .where(eq(schema.milestone.projectId, parsed.projectId))
      .orderBy(asc(schema.milestone.sortOrder))
      .limit(1);
    const [created] = await tx
      .insert(schema.milestone)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        projectId: parsed.projectId,
        name: parsed.name,
        description: parsed.description,
        targetDate: toDateString(parsed.targetDate) ?? null,
        sortOrder: (last?.sortOrder ?? 0) + SORT_ORDER_STEP,
        syncId,
      })
      .returning();
    const milestone = requireRow(created, 'The milestone could not be created.');
    return {
      milestone,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: milestoneScopes(milestone),
          action: 'insert',
          model: 'milestone',
          modelId: milestone.id,
          data: milestone,
          actor,
        }),
      ],
    };
  });
}

export async function updateMilestone(
  principal: Principal,
  milestoneId: string,
  input: unknown,
): Promise<{ milestone: MilestoneRow; actions: SyncAction[] }> {
  assertCan(principal, 'milestone:manage');
  const parsed = pickProvided(input, milestoneUpdateSchema.parse(input));

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.milestone.$inferInsert> = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.description !== undefined) values.description = parsed.description;
    if (parsed.targetDate !== undefined) values.targetDate = toDateString(parsed.targetDate);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.milestone)
      .set({ ...values, syncId })
      .where(
        and(
          eq(schema.milestone.id, milestoneId),
          eq(schema.milestone.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const milestone = requireRow(updated, 'That milestone does not exist.');
    return {
      milestone,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: milestoneScopes(milestone),
          action: 'update',
          model: 'milestone',
          modelId: milestone.id,
          data: milestone,
          actor,
        }),
      ],
    };
  });
}

export async function deleteMilestone(
  principal: Principal,
  milestoneId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'milestone:manage');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.milestone)
      .where(
        and(
          eq(schema.milestone.id, milestoneId),
          eq(schema.milestone.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const milestone = requireRow(existing, 'That milestone does not exist.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.delete(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: milestoneScopes(milestone),
        action: 'delete',
        model: 'milestone',
        modelId: milestoneId,
        data: { id: milestoneId, projectId: milestone.projectId },
        actor,
      }),
    ];
  });
}

export async function listMilestones(
  principal: Principal,
  projectId: string,
): Promise<MilestoneRow[]> {
  assertCan(principal, 'project:read');
  await assertProjectInOrganization(db, principal.organizationId, projectId);
  return await db
    .select()
    .from(schema.milestone)
    .where(
      and(
        eq(schema.milestone.projectId, projectId),
        eq(schema.milestone.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.milestone.sortOrder));
}

export async function reorderMilestones(
  principal: Principal,
  projectId: string,
  orderedMilestoneIds: readonly string[],
): Promise<{ milestones: MilestoneRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'milestone:manage');
  if (orderedMilestoneIds.length === 0) throw conflict('Provide the milestones to reorder.');

  return await db.transaction(async (tx) => {
    await assertProjectInOrganization(tx, principal.organizationId, projectId);
    const existing = await tx
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(
        and(
          eq(schema.milestone.organizationId, principal.organizationId),
          eq(schema.milestone.projectId, projectId),
          inArray(schema.milestone.id, [...orderedMilestoneIds]),
        ),
      );
    if (existing.length !== orderedMilestoneIds.length) {
      throw conflict('Some of those milestones do not belong to this project.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const milestones: MilestoneRow[] = [];
    for (const [index, id] of orderedMilestoneIds.entries()) {
      const [updated] = await tx
        .update(schema.milestone)
        .set({ sortOrder: (index + 1) * SORT_ORDER_STEP, syncId })
        .where(eq(schema.milestone.id, id))
        .returning();
      if (updated !== undefined) milestones.push(updated);
    }

    return {
      milestones,
      actions: milestones.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: milestoneScopes(row),
          action: 'update',
          model: 'milestone',
          modelId: row.id,
          data: row,
          actor,
        }),
      ),
    };
  });
}
