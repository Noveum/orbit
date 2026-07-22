import { and, asc, count, db, eq, inArray, isNull, schema, sql } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { slugify } from '@orbit/shared/utils';
import {
  projectCreateSchema,
  projectUpdatePostSchema,
  projectUpdateSchema,
} from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow, toDateString } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type ProjectRow = typeof schema.project.$inferSelect;
export type ProjectUpdateRow = typeof schema.projectUpdate.$inferSelect;

function projectScopes(row: ProjectRow): string[] {
  return [scopes.organization(row.organizationId), scopes.project(row.id)];
}

async function allocateProjectSlug(
  executor: Executor,
  organizationId: string,
  name: string,
): Promise<string> {
  const base = slugify(name) || 'project';
  const taken = await executor
    .select({ slug: schema.project.slug })
    .from(schema.project)
    .where(eq(schema.project.organizationId, organizationId));
  const used = new Set(taken.map((row) => row.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw conflict('Could not allocate a project address.');
}

async function replaceProjectTeams(
  executor: Executor,
  projectId: string,
  teamIds: readonly string[],
): Promise<void> {
  await executor.delete(schema.projectTeam).where(eq(schema.projectTeam.projectId, projectId));
  if (teamIds.length === 0) return;
  await executor
    .insert(schema.projectTeam)
    .values([...new Set(teamIds)].map((teamId) => ({ id: newId(), projectId, teamId })))
    .onConflictDoNothing();
}

export async function createProject(
  principal: Principal,
  input: unknown,
): Promise<{ project: ProjectRow; actions: SyncAction[] }> {
  assertCan(principal, 'project:manage');
  const parsed = projectCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const slug = await allocateProjectSlug(tx, principal.organizationId, parsed.name);
    const [created] = await tx
      .insert(schema.project)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        name: parsed.name,
        slug,
        summary: parsed.summary,
        description: parsed.description,
        status: parsed.status,
        health: parsed.health,
        leadId: parsed.leadId,
        startDate: toDateString(parsed.startDate) ?? null,
        targetDate: toDateString(parsed.targetDate) ?? null,
        ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
        ...(parsed.color === undefined ? {} : { color: parsed.color }),
        syncId,
      })
      .returning();
    const project = requireRow(created, 'The project could not be created.');
    await replaceProjectTeams(tx, project.id, parsed.teamIds);

    return {
      project,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [...projectScopes(project), ...parsed.teamIds.map((id) => scopes.team(id))],
          action: 'insert',
          model: 'project',
          modelId: project.id,
          data: project,
          actor,
        }),
      ],
    };
  });
}

function projectUpdateValues(
  parsed: ReturnType<typeof projectUpdateSchema.parse>,
): Partial<typeof schema.project.$inferInsert> {
  const values: Partial<typeof schema.project.$inferInsert> = { updatedAt: new Date() };
  if (parsed.name !== undefined) values.name = parsed.name;
  if (parsed.summary !== undefined) values.summary = parsed.summary;
  if (parsed.description !== undefined) values.description = parsed.description;
  if (parsed.status !== undefined) values.status = parsed.status;
  if (parsed.health !== undefined) values.health = parsed.health;
  if (parsed.leadId !== undefined) values.leadId = parsed.leadId;
  if (parsed.startDate !== undefined) values.startDate = toDateString(parsed.startDate);
  if (parsed.targetDate !== undefined) values.targetDate = toDateString(parsed.targetDate);
  if (parsed.icon !== undefined) values.icon = parsed.icon;
  if (parsed.color !== undefined) values.color = parsed.color;
  return values;
}

export async function updateProject(
  principal: Principal,
  projectId: string,
  input: unknown,
): Promise<{ project: ProjectRow; actions: SyncAction[] }> {
  assertCan(principal, 'project:manage');
  const parsed = projectUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const values = projectUpdateValues(parsed);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.project)
      .set({ ...values, syncId })
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const project = requireRow(updated, 'That project does not exist.');
    if (parsed.teamIds !== undefined) await replaceProjectTeams(tx, projectId, parsed.teamIds);

    return {
      project,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: projectScopes(project),
          action: 'update',
          model: 'project',
          modelId: project.id,
          data: project,
          actor,
        }),
      ],
    };
  });
}

export async function archiveProject(
  principal: Principal,
  projectId: string,
): Promise<{ project: ProjectRow; actions: SyncAction[] }> {
  assertCan(principal, 'project:manage');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.project)
      .set({ archivedAt: new Date(), updatedAt: new Date(), syncId })
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const project = requireRow(updated, 'That project does not exist.');
    return {
      project,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: projectScopes(project),
          action: 'archive',
          model: 'project',
          modelId: project.id,
          data: project,
          actor,
        }),
      ],
    };
  });
}

export async function deleteProject(
  principal: Principal,
  projectId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'project:manage');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.project)
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    const project = requireRow(existing, 'That project does not exist.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx.delete(schema.project).where(eq(schema.project.id, projectId));
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: projectScopes(project),
        action: 'delete',
        model: 'project',
        modelId: projectId,
        data: { id: projectId },
        actor,
      }),
    ];
  });
}

export async function listProjects(
  principal: Principal,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectRow[]> {
  assertCan(principal, 'project:read');
  const filters = [eq(schema.project.organizationId, principal.organizationId)];
  if (options.includeArchived !== true) filters.push(isNull(schema.project.archivedAt));
  return await db
    .select()
    .from(schema.project)
    .where(and(...filters))
    .orderBy(asc(schema.project.sortOrder), asc(schema.project.name));
}

export async function getProject(principal: Principal, projectId: string): Promise<ProjectRow> {
  assertCan(principal, 'project:read');
  const [row] = await db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.id, projectId),
        eq(schema.project.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  return requireRow(row, 'That project does not exist.');
}

export async function addProjectTeam(
  principal: Principal,
  projectId: string,
  teamId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'project:manage');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .insert(schema.projectTeam)
      .values({ id: newId(), projectId, teamId })
      .onConflictDoNothing();
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.project(projectId), scopes.team(teamId)],
        action: 'update',
        model: 'project',
        modelId: projectId,
        data: { projectId, teamId },
        actor,
      }),
    ];
  });
}

export async function removeProjectTeam(
  principal: Principal,
  projectId: string,
  teamId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'project:manage');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    await tx
      .delete(schema.projectTeam)
      .where(
        and(eq(schema.projectTeam.projectId, projectId), eq(schema.projectTeam.teamId, teamId)),
      );
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.project(projectId), scopes.team(teamId)],
        action: 'update',
        model: 'project',
        modelId: projectId,
        data: { projectId, teamId, removed: true },
        actor,
      }),
    ];
  });
}

export async function listProjectTeams(
  principal: Principal,
  projectId: string,
): Promise<{ teamId: string }[]> {
  assertCan(principal, 'project:read');
  return await db
    .select({ teamId: schema.projectTeam.teamId })
    .from(schema.projectTeam)
    .where(eq(schema.projectTeam.projectId, projectId));
}

export async function postProjectUpdate(
  principal: Principal,
  projectId: string,
  input: unknown,
): Promise<{ update: ProjectUpdateRow; project: ProjectRow; actions: SyncAction[] }> {
  assertCan(principal, 'project:manage');
  const parsed = projectUpdatePostSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.projectUpdate)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        projectId,
        authorId: principal.userId,
        health: parsed.health,
        body: parsed.body,
        syncId,
      })
      .returning();
    const update = requireRow(created, 'The project update could not be posted.');

    const [updatedProject] = await tx
      .update(schema.project)
      .set({ health: parsed.health, updatedAt: new Date(), syncId })
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const project = requireRow(updatedProject, 'That project does not exist.');

    return {
      update,
      project,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: projectScopes(project),
          action: 'update',
          model: 'project',
          modelId: project.id,
          data: { ...project, latestUpdate: update },
          actor,
        }),
      ],
    };
  });
}

export async function listProjectUpdates(
  principal: Principal,
  projectId: string,
  limit = 20,
): Promise<ProjectUpdateRow[]> {
  assertCan(principal, 'project:read');
  return await db
    .select()
    .from(schema.projectUpdate)
    .where(
      and(
        eq(schema.projectUpdate.projectId, projectId),
        eq(schema.projectUpdate.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.projectUpdate.createdAt))
    .limit(limit);
}

export interface MilestoneProgress {
  readonly milestoneId: string;
  readonly name: string;
  readonly scope: number;
  readonly completed: number;
}

export interface ProjectProgress {
  readonly projectId: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly milestones: MilestoneProgress[];
}

const CATEGORY_EXPRESSION = sql<string>`${schema.workflowState.category}`;

export async function projectProgress(
  principal: Principal,
  projectId: string,
): Promise<ProjectProgress> {
  assertCan(principal, 'project:read');

  const rows = await db
    .select({
      milestoneId: schema.issue.milestoneId,
      category: CATEGORY_EXPRESSION,
      total: count(),
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        eq(schema.issue.organizationId, principal.organizationId),
        eq(schema.issue.projectId, projectId),
        isNull(schema.issue.archivedAt),
      ),
    )
    .groupBy(schema.issue.milestoneId, CATEGORY_EXPRESSION);

  const milestoneRows = await db
    .select({ id: schema.milestone.id, name: schema.milestone.name })
    .from(schema.milestone)
    .where(eq(schema.milestone.projectId, projectId))
    .orderBy(asc(schema.milestone.sortOrder));

  let scope = 0;
  let started = 0;
  let completed = 0;
  const perMilestone = new Map<string, { scope: number; completed: number }>();

  for (const row of rows) {
    scope += row.total;
    if (row.category === 'started' || row.category === 'review') started += row.total;
    if (row.category === 'completed') completed += row.total;
    if (row.milestoneId === null) continue;
    const bucket = perMilestone.get(row.milestoneId) ?? { scope: 0, completed: 0 };
    bucket.scope += row.total;
    if (row.category === 'completed') bucket.completed += row.total;
    perMilestone.set(row.milestoneId, bucket);
  }

  return {
    projectId,
    scope,
    started,
    completed,
    milestones: milestoneRows.map((milestone) => ({
      milestoneId: milestone.id,
      name: milestone.name,
      scope: perMilestone.get(milestone.id)?.scope ?? 0,
      completed: perMilestone.get(milestone.id)?.completed ?? 0,
    })),
  };
}

export async function listProjectsForTeams(
  principal: Principal,
  teamIds: readonly string[],
): Promise<ProjectRow[]> {
  assertCan(principal, 'project:read');
  if (teamIds.length === 0) return [];
  return await db
    .select()
    .from(schema.project)
    .where(
      and(
        eq(schema.project.organizationId, principal.organizationId),
        inArray(
          schema.project.id,
          db
            .select({ id: schema.projectTeam.projectId })
            .from(schema.projectTeam)
            .where(inArray(schema.projectTeam.teamId, [...teamIds])),
        ),
      ),
    )
    .orderBy(asc(schema.project.name));
}
