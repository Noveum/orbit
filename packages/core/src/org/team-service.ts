import { and, asc, db, eq, inArray, isNull, schema } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam } from '@orbit/shared/policy';
import { teamCreateSchema, teamMemberSchema, teamUpdateSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { addUtcDays, type Executor, newId, requireRow, startOfUtcDay } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import type { CycleRow } from '../work/cycle-service.ts';
import { createDefaultWorkflowStates } from '../work/workflow-state-service.ts';

export type TeamRow = typeof schema.team.$inferSelect;
export type TeamMemberRow = typeof schema.teamMember.$inferSelect;

export function deriveTeamKey(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 0);
  const initials = words.map((word) => word[0] ?? '').join('');
  const candidate = initials.length >= 2 ? initials : letters;
  const trimmed = candidate.slice(0, 6);
  if (trimmed.length >= 2 && /^[A-Z]/.test(trimmed)) return trimmed;
  return `TEAM${trimmed}`.slice(0, 6);
}

export async function allocateTeamKey(
  executor: Executor,
  organizationId: string,
  desired: string,
): Promise<string> {
  const base = desired.slice(0, 6);
  const taken = await executor
    .select({ key: schema.team.key })
    .from(schema.team)
    .where(eq(schema.team.organizationId, organizationId));
  const used = new Set(taken.map((row) => row.key));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base.slice(0, 6 - String(suffix).length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw conflict('Could not allocate a team key.', { details: { desired } });
}

export async function createFirstCycle(
  executor: Executor,
  params: { organizationId: string; teamId: string; syncId: number; now?: Date },
): Promise<CycleRow> {
  const startsAt = startOfUtcDay(params.now ?? new Date());
  const [row] = await executor
    .insert(schema.cycle)
    .values({
      id: newId(),
      organizationId: params.organizationId,
      teamId: params.teamId,
      number: 1,
      name: 'Cycle 1',
      startsAt,
      endsAt: addUtcDays(startsAt, 14),
      syncId: params.syncId,
    })
    .returning();
  return requireRow(row, 'The first cycle could not be created.');
}

export interface TeamBootstrap {
  readonly team: TeamRow;
  readonly states: (typeof schema.workflowState.$inferSelect)[];
  readonly cycle: CycleRow;
}

export async function bootstrapTeam(
  executor: Executor,
  params: {
    organizationId: string;
    creatorId: string;
    name: string;
    key: string;
    description?: string;
    icon?: string;
    color?: string;
    syncId: number;
  },
): Promise<TeamBootstrap> {
  const key = await allocateTeamKey(executor, params.organizationId, params.key);
  const [created] = await executor
    .insert(schema.team)
    .values({
      id: newId(),
      organizationId: params.organizationId,
      name: params.name,
      key,
      description: params.description ?? '',
      ...(params.icon === undefined ? {} : { icon: params.icon }),
      ...(params.color === undefined ? {} : { color: params.color }),
      syncId: params.syncId,
    })
    .returning();
  const team = requireRow(created, 'The team could not be created.');

  await executor
    .insert(schema.teamMember)
    .values({ id: newId(), teamId: team.id, userId: params.creatorId })
    .onConflictDoNothing();

  const states = await createDefaultWorkflowStates(executor, {
    organizationId: params.organizationId,
    teamId: team.id,
    syncId: params.syncId,
  });
  const cycle = await createFirstCycle(executor, {
    organizationId: params.organizationId,
    teamId: team.id,
    syncId: params.syncId,
  });

  return { team, states, cycle };
}

export async function createTeam(
  principal: Principal,
  input: unknown,
): Promise<{
  team: TeamRow;
  states: TeamBootstrap['states'];
  cycle: CycleRow;
  actions: SyncAction[];
}> {
  assertCan(principal, 'team:manage');
  const parsed = teamCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const bootstrap = await bootstrapTeam(tx, {
      organizationId: principal.organizationId,
      creatorId: principal.userId,
      name: parsed.name,
      key: parsed.key,
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
      ...(parsed.color === undefined ? {} : { color: parsed.color }),
      syncId,
    });

    return {
      ...bootstrap,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.organization(principal.organizationId), scopes.team(bootstrap.team.id)],
          action: 'insert',
          model: 'team',
          modelId: bootstrap.team.id,
          data: bootstrap.team,
          actor,
        }),
      ],
    };
  });
}

export async function updateTeam(
  principal: Principal,
  teamId: string,
  input: unknown,
): Promise<{ team: TeamRow; actions: SyncAction[] }> {
  assertCan(principal, 'team:manage');
  const parsed = teamUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const values: Partial<typeof schema.team.$inferInsert> = { updatedAt: new Date() };
    if (parsed.name !== undefined) values.name = parsed.name;
    if (parsed.description !== undefined) values.description = parsed.description;
    if (parsed.icon !== undefined) values.icon = parsed.icon;
    if (parsed.color !== undefined) values.color = parsed.color;

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.team)
      .set({ ...values, syncId })
      .where(
        and(eq(schema.team.id, teamId), eq(schema.team.organizationId, principal.organizationId)),
      )
      .returning();
    const team = requireRow(updated, 'That team does not exist.');
    return {
      team,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.organization(principal.organizationId), scopes.team(team.id)],
          action: 'update',
          model: 'team',
          modelId: team.id,
          data: team,
          actor,
        }),
      ],
    };
  });
}

export async function archiveTeam(
  principal: Principal,
  teamId: string,
): Promise<{ team: TeamRow; actions: SyncAction[] }> {
  assertCan(principal, 'team:manage');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.team)
      .set({ archivedAt: new Date(), updatedAt: new Date(), syncId })
      .where(
        and(eq(schema.team.id, teamId), eq(schema.team.organizationId, principal.organizationId)),
      )
      .returning();
    const team = requireRow(updated, 'That team does not exist.');
    return {
      team,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.organization(principal.organizationId), scopes.team(team.id)],
          action: 'archive',
          model: 'team',
          modelId: team.id,
          data: team,
          actor,
        }),
      ],
    };
  });
}

export async function addTeamMember(
  principal: Principal,
  teamId: string,
  input: unknown,
): Promise<{ teamMember: TeamMemberRow; actions: SyncAction[] }> {
  assertCan(principal, 'team:manage');
  const parsed = teamMemberSchema.parse(input);

  return await db.transaction(async (tx) => {
    const [team] = await tx
      .select()
      .from(schema.team)
      .where(
        and(eq(schema.team.id, teamId), eq(schema.team.organizationId, principal.organizationId)),
      )
      .limit(1);
    requireRow(team, 'That team does not exist.');

    const [membership] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, principal.organizationId),
          eq(schema.member.userId, parsed.userId),
        ),
      )
      .limit(1);
    if (membership === undefined) {
      throw conflict('That person is not a member of this organization.');
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [inserted] = await tx
      .insert(schema.teamMember)
      .values({ id: newId(), teamId, userId: parsed.userId })
      .onConflictDoUpdate({
        target: [schema.teamMember.teamId, schema.teamMember.userId],
        set: { teamId },
      })
      .returning();
    const row = requireRow(inserted, 'That team membership could not be created.');
    return {
      teamMember: row,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: [scopes.team(teamId), scopes.user(parsed.userId)],
          action: 'insert',
          model: 'member',
          modelId: row.id,
          data: row,
          actor,
        }),
      ],
    };
  });
}

export async function removeTeamMember(
  principal: Principal,
  teamId: string,
  userId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'team:manage');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [removed] = await tx
      .delete(schema.teamMember)
      .where(and(eq(schema.teamMember.teamId, teamId), eq(schema.teamMember.userId, userId)))
      .returning();
    const row = requireRow(removed, 'That person is not on this team.');
    return [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.team(teamId), scopes.user(userId)],
        action: 'delete',
        model: 'member',
        modelId: row.id,
        data: { id: row.id, teamId, userId },
        actor,
      }),
    ];
  });
}

export async function listTeams(
  principal: Principal,
  options: { includeArchived?: boolean } = {},
): Promise<TeamRow[]> {
  const filters = [eq(schema.team.organizationId, principal.organizationId)];
  if (options.includeArchived !== true) filters.push(isNull(schema.team.archivedAt));
  if (principal.role !== 'admin') {
    if (principal.teamIds.length === 0) return [];
    filters.push(inArray(schema.team.id, [...principal.teamIds]));
  }
  return await db
    .select()
    .from(schema.team)
    .where(and(...filters))
    .orderBy(asc(schema.team.name));
}

export async function getTeam(principal: Principal, teamId: string): Promise<TeamRow> {
  assertInTeam(principal, teamId);
  const [row] = await db
    .select()
    .from(schema.team)
    .where(
      and(eq(schema.team.id, teamId), eq(schema.team.organizationId, principal.organizationId)),
    )
    .limit(1);
  return requireRow(row, 'That team does not exist.');
}

export async function listTeamMembers(
  principal: Principal,
  teamId: string,
): Promise<TeamMemberRow[]> {
  assertInTeam(principal, teamId);
  return await db.select().from(schema.teamMember).where(eq(schema.teamMember.teamId, teamId));
}
