import { and, asc, db, desc, eq, schema } from '@orbit/db';
import { SORT_ORDER_STEP } from '@orbit/shared/constants';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import {
  milestoneCreateSchema,
  milestoneOrderSchema,
  milestoneUpdateSchema,
} from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow, toDateString } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import {
  assertProjectVisible,
  projectProgress,
  projectReachScopes,
  projectTeamIds,
} from './project-service.ts';

export type MilestoneRow = typeof schema.milestone.$inferSelect;

async function milestoneScopes(executor: Executor, row: MilestoneRow): Promise<string[]> {
  return projectReachScopes(
    row.organizationId,
    row.projectId,
    await projectTeamIds(executor, row.projectId),
  );
}

async function assertMilestoneReachable(
  executor: Executor,
  principal: Principal,
  milestoneId: string,
): Promise<MilestoneRow> {
  const [row] = await executor
    .select()
    .from(schema.milestone)
    .where(
      and(
        eq(schema.milestone.id, milestoneId),
        eq(schema.milestone.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  const milestone = requireRow(row, 'That milestone does not exist.');
  await assertProjectVisible(executor, principal, milestone.projectId);
  return milestone;
}

export async function createMilestone(
  principal: Principal,
  input: unknown,
): Promise<{ milestone: MilestoneRow; actions: SyncAction[] }> {
  assertCan(principal, 'milestone:manage');
  const parsed = milestoneCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    await assertProjectVisible(tx, principal, parsed.projectId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [last] = await tx
      .select({ sortOrder: schema.milestone.sortOrder })
      .from(schema.milestone)
      .where(eq(schema.milestone.projectId, parsed.projectId))
      .orderBy(desc(schema.milestone.sortOrder), desc(schema.milestone.createdAt))
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
          scopes: await milestoneScopes(tx, milestone),
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
  const parsed = milestoneUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    await assertMilestoneReachable(tx, principal, milestoneId);

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
          scopes: await milestoneScopes(tx, milestone),
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
    const milestone = await assertMilestoneReachable(tx, principal, milestoneId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const reach = await milestoneScopes(tx, milestone);
    await tx.delete(schema.milestone).where(eq(schema.milestone.id, milestoneId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: reach,
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
  await assertProjectVisible(db, principal, projectId);
  return await db
    .select()
    .from(schema.milestone)
    .where(
      and(
        eq(schema.milestone.projectId, projectId),
        eq(schema.milestone.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.milestone.sortOrder), asc(schema.milestone.createdAt));
}

export interface MilestoneWithProgress {
  readonly milestone: MilestoneRow;
  readonly scope: number;
  readonly completed: number;
}

export async function listMilestonesWithProgress(
  principal: Principal,
  projectId: string,
): Promise<MilestoneWithProgress[]> {
  const [milestones, progress] = await Promise.all([
    listMilestones(principal, projectId),
    projectProgress(principal, projectId),
  ]);
  const counted = new Map(progress.milestones.map((entry) => [entry.milestoneId, entry]));
  return milestones.map((milestone) => ({
    milestone,
    scope: counted.get(milestone.id)?.scope ?? 0,
    completed: counted.get(milestone.id)?.completed ?? 0,
  }));
}

export async function reorderMilestones(
  principal: Principal,
  projectId: string,
  input: readonly string[],
): Promise<{ milestones: MilestoneRow[]; actions: SyncAction[] }> {
  assertCan(principal, 'milestone:manage');
  const orderedMilestoneIds = milestoneOrderSchema.parse(input);
  if (orderedMilestoneIds.length === 0) throw conflict('Provide the milestones to reorder.');

  return await db.transaction(async (tx) => {
    await assertProjectVisible(tx, principal, projectId);
    const requested = new Set(orderedMilestoneIds);
    if (requested.size !== orderedMilestoneIds.length) {
      throw conflict('That order lists the same milestone twice.');
    }
    const existing = await tx
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(
        and(
          eq(schema.milestone.organizationId, principal.organizationId),
          eq(schema.milestone.projectId, projectId),
        ),
      );
    if (existing.length !== requested.size || existing.some((row) => !requested.has(row.id))) {
      throw conflict('That order has to list every milestone in this project, and only those.');
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

    const reach = projectReachScopes(
      principal.organizationId,
      projectId,
      await projectTeamIds(tx, projectId),
    );
    return {
      milestones,
      actions: milestones.map((row) =>
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: reach,
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
