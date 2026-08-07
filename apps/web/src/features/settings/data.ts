import {
  listLabels,
  listMembers,
  listPendingInvites,
  listTeams,
  listWorkflowStatesForTeams,
} from '@orbit/core';
import { and, db, eq, inArray, schema } from '@orbit/db';
import type { OrgRole, StateCategory } from '@orbit/shared/constants';
import { ORG_ROLES, STATE_CATEGORIES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';

export interface TeamBadge {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface MemberView {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly handle: string | null;
  readonly email: string;
  readonly image: string | null;
  readonly role: OrgRole;
  readonly joinedAt: string;
  readonly teams: TeamBadge[];
}

export interface PendingInviteView {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly teamIds: string[];
  readonly expiresAt: string;
  readonly createdAt: string;
}

function toOrgRole(value: string): OrgRole {
  return ORG_ROLES.find((role) => role === value) ?? 'guest';
}

export async function listMemberViews(principal: Principal): Promise<MemberView[]> {
  const members = await listMembers(principal);
  const userIds = members.map((row) => row.user.id);
  const memberships =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: schema.teamMember.userId,
            id: schema.team.id,
            key: schema.team.key,
            name: schema.team.name,
          })
          .from(schema.teamMember)
          .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
          .where(
            and(
              inArray(schema.teamMember.userId, userIds),
              eq(schema.team.organizationId, principal.organizationId),
            ),
          );

  const byUser = new Map<string, TeamBadge[]>();
  for (const row of memberships) {
    const bucket = byUser.get(row.userId) ?? [];
    bucket.push({ id: row.id, key: row.key, name: row.name });
    byUser.set(row.userId, bucket);
  }

  return members.map(({ member, user }) => ({
    memberId: member.id,
    userId: user.id,
    name: user.name,
    handle: user.handle,
    email: user.email,
    image: user.image,
    role: toOrgRole(member.role),
    joinedAt: member.createdAt.toISOString(),
    teams: byUser.get(user.id) ?? [],
  }));
}

export async function listPendingInviteViews(principal: Principal): Promise<PendingInviteView[]> {
  const invites = await listPendingInvites(principal);
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    teamIds: invite.teamIds,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }));
}

export async function listTeamBadges(principal: Principal): Promise<TeamBadge[]> {
  const teams = await listTeams(principal);
  return teams.map((team) => ({ id: team.id, key: team.key, name: team.name }));
}

export interface TeamDetail extends TeamBadge {
  readonly description: string;
  readonly archivedAt: string | null;
  readonly memberIds: string[];
}

export async function listTeamDetails(principal: Principal): Promise<TeamDetail[]> {
  const teams = await listTeams(principal, { includeArchived: true });
  const teamIds = teams.map((team) => team.id);
  const rows =
    teamIds.length === 0
      ? []
      : await db
          .select({ teamId: schema.teamMember.teamId, userId: schema.teamMember.userId })
          .from(schema.teamMember)
          .where(inArray(schema.teamMember.teamId, teamIds));

  const byTeam = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byTeam.get(row.teamId) ?? [];
    bucket.push(row.userId);
    byTeam.set(row.teamId, bucket);
  }

  return teams.map((team) => ({
    id: team.id,
    key: team.key,
    name: team.name,
    description: team.description,
    archivedAt: team.archivedAt?.toISOString() ?? null,
    memberIds: byTeam.get(team.id) ?? [],
  }));
}

export interface LabelView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly teamId: string | null;
}

export async function listLabelViews(principal: Principal): Promise<LabelView[]> {
  const labels = await listLabels(principal);
  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    teamId: label.teamId,
  }));
}

export interface WorkflowStateView {
  readonly id: string;
  readonly teamId: string;
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string;
  readonly position: number;
}

function toStateCategory(value: string): StateCategory {
  return STATE_CATEGORIES.find((category) => category === value) ?? 'unstarted';
}

export async function listWorkflowStateViews(
  principal: Principal,
  teamIds: readonly string[],
): Promise<WorkflowStateView[]> {
  const states = await listWorkflowStatesForTeams(principal, teamIds);
  return states.map((state) => ({
    id: state.id,
    teamId: state.teamId,
    name: state.name,
    category: toStateCategory(state.category),
    color: state.color,
    position: state.position,
  }));
}
