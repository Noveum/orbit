import { listLabels, listMembers, listProjectsForTeams, listTeams } from '@orbit/core';
import { and, asc, db, eq, inArray, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';

const CYCLES_PER_TEAM = 6;

export interface BootstrapQuery {
  readonly team?: string | undefined;
}

async function listWorkflowStatesForTeams(principal: Principal, teamIds: readonly string[]) {
  if (teamIds.length === 0) return [];
  return await db
    .select({
      id: schema.workflowState.id,
      teamId: schema.workflowState.teamId,
      name: schema.workflowState.name,
      category: schema.workflowState.category,
      color: schema.workflowState.color,
      position: schema.workflowState.position,
    })
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.organizationId, principal.organizationId),
        inArray(schema.workflowState.teamId, [...teamIds]),
      ),
    )
    .orderBy(asc(schema.workflowState.position));
}

async function listRecentCyclesForTeams(principal: Principal, teamIds: readonly string[]) {
  if (teamIds.length === 0) return [];
  const ranked = db
    .select({
      id: schema.cycle.id,
      teamId: schema.cycle.teamId,
      number: schema.cycle.number,
      name: schema.cycle.name,
      startsAt: schema.cycle.startsAt,
      endsAt: schema.cycle.endsAt,
      completedAt: schema.cycle.completedAt,
      rank: sql<number>`row_number() over (partition by ${schema.cycle.teamId} order by ${schema.cycle.number} desc)`.as(
        'rank',
      ),
    })
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        inArray(schema.cycle.teamId, [...teamIds]),
      ),
    )
    .as('ranked');

  return await db
    .select({
      id: ranked.id,
      teamId: ranked.teamId,
      number: ranked.number,
      name: ranked.name,
      startsAt: ranked.startsAt,
      endsAt: ranked.endsAt,
      completedAt: ranked.completedAt,
    })
    .from(ranked)
    .where(sql`${ranked.rank} <= ${CYCLES_PER_TEAM}`)
    .orderBy(asc(ranked.teamId), asc(ranked.number));
}

export async function bootstrapVersion(principal: Principal): Promise<string> {
  const organizationId = principal.organizationId;
  const [row] = await db.execute<{ version: string | null }>(sql`
    select greatest(
      coalesce((select max(sync_id) from team where organization_id = ${organizationId}), 0),
      coalesce((select max(sync_id) from workflow_state where organization_id = ${organizationId}), 0),
      coalesce((select max(sync_id) from cycle where organization_id = ${organizationId}), 0),
      coalesce((select max(sync_id) from label where organization_id = ${organizationId}), 0),
      coalesce((select max(sync_id) from project where organization_id = ${organizationId}), 0),
      coalesce((select max(sync_id) from member where organization_id = ${organizationId}), 0)
    )::text as version
  `);
  return `${principal.userId}-${row?.['version'] ?? '0'}`;
}

export async function bootstrapPayload(principal: Principal, query: BootstrapQuery) {
  assertCan(principal, 'issue:read');
  const teams = await listTeams(principal);
  const activeTeam = teams.find((team) => team.key === query.team) ?? teams[0] ?? null;
  const teamIds = teams.map((team) => team.id);

  const [states, cycles, labels, members, projects] = await Promise.all([
    listWorkflowStatesForTeams(principal, teamIds),
    listRecentCyclesForTeams(principal, teamIds),
    listLabels(principal),
    listMembers(principal),
    listProjectsForTeams(principal, teamIds),
  ]);

  return {
    userId: principal.userId,
    organizationId: principal.organizationId,
    role: principal.role,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
      icon: team.icon,
      color: team.color,
    })),
    activeTeamId: activeTeam?.id ?? null,
    states,
    cycles,
    labels: labels.map((label) => ({
      id: label.id,
      teamId: label.teamId,
      name: label.name,
      color: label.color,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      color: project.color,
      icon: project.icon,
    })),
    members: members.map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      image: row.user.image,
      handle: row.user.handle,
      role: row.member.role,
    })),
  };
}
