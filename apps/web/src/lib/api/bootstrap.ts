import {
  listLabels,
  listMembers,
  listProjectsForTeams,
  listTeams,
  listWorkflowStatesForTeams,
  projectTeamLinks,
} from '@orbit/core';
import { and, db, desc, eq, isNull, schema, sql } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';

export interface BootstrapQuery {
  readonly team?: string | undefined;
}

async function boardColumnsForTeams(principal: Principal, teamIds: readonly string[]) {
  const states = await listWorkflowStatesForTeams(principal, teamIds);
  return states.map((state) => ({
    id: state.id,
    teamId: state.teamId,
    name: state.name,
    category: state.category,
    color: state.color,
    position: state.position,
  }));
}

async function listWorkspaceCycles(principal: Principal) {
  return await db
    .select({
      id: schema.cycle.id,
      teamId: schema.cycle.teamId,
      number: schema.cycle.number,
      name: schema.cycle.name,
      startsAt: schema.cycle.startsAt,
      endsAt: schema.cycle.endsAt,
      completedAt: schema.cycle.completedAt,
    })
    .from(schema.cycle)
    .where(
      and(
        eq(schema.cycle.organizationId, principal.organizationId),
        isNull(schema.cycle.archivedAt),
      ),
    )
    .orderBy(desc(schema.cycle.number));
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
  return `${principal.userId}-${organizationId}-${row?.['version'] ?? '0'}`;
}

export type BootstrapTeams = Readonly<{
  teams: Awaited<ReturnType<typeof listTeams>>;
  activeTeam: Awaited<ReturnType<typeof listTeams>>[number] | null;
}>;

export async function bootstrapTeams(
  principal: Principal,
  query: BootstrapQuery,
): Promise<BootstrapTeams> {
  assertCan(principal, 'issue:read');
  const teams = await listTeams(principal);
  return { teams, activeTeam: teams.find((team) => team.key === query.team) ?? teams[0] ?? null };
}

export async function bootstrapPayloadFor(principal: Principal, resolved: BootstrapTeams) {
  const { teams, activeTeam } = resolved;
  const teamIds = teams.map((team) => team.id);

  const [states, cycles, labels, members, projects, links] = await Promise.all([
    boardColumnsForTeams(principal, teamIds),
    listWorkspaceCycles(principal),
    listLabels(principal),
    listMembers(principal),
    listProjectsForTeams(principal, teamIds),
    projectTeamLinks(principal, teamIds),
  ]);

  const teamsByProject = new Map<string, string[]>();
  for (const link of links) {
    const found = teamsByProject.get(link.projectId) ?? [];
    found.push(link.teamId);
    teamsByProject.set(link.projectId, found);
  }

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
      slug: project.slug,
      name: project.name,
      status: project.status,
      color: project.color,
      icon: project.icon,
      teamIds: teamsByProject.get(project.id) ?? [],
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

export async function bootstrapPayload(principal: Principal, query: BootstrapQuery) {
  return await bootstrapPayloadFor(principal, await bootstrapTeams(principal, query));
}
