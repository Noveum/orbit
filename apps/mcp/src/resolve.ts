import {
  activeCycle,
  type CycleRow,
  listCycles,
  listLabels,
  listMembers,
  listProjects,
  listTeams,
  listWorkflowStates,
  type ProjectRow,
  type TeamRow,
} from '@orbit/core';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';

function matches(candidates: readonly (string | null | undefined)[], ref: string): boolean {
  const needle = ref.trim().toLowerCase();
  return candidates.some(
    (candidate) => typeof candidate === 'string' && candidate.toLowerCase() === needle,
  );
}

function pick<T>(
  rows: readonly T[],
  ref: string,
  candidates: (row: T) => readonly (string | null | undefined)[],
): T | undefined {
  return rows.find((row) => matches(candidates(row), ref));
}

export async function resolveTeam(principal: Principal, ref: string): Promise<TeamRow> {
  const teams = await listTeams(principal);
  const found = pick(teams, ref, (team) => [team.id, team.key, team.name]);
  if (found === undefined) throw notFound(`No team matches "${ref}".`);
  return found;
}

export async function resolveUserId(principal: Principal, ref: string): Promise<string> {
  if (ref.trim().toLowerCase() === 'me') return principal.userId;
  const members = await listMembers(principal);
  const found = pick(members, ref, (row) => [
    row.user.id,
    row.user.email,
    row.user.handle,
    row.user.name,
  ]);
  if (found === undefined) throw notFound(`No user matches "${ref}".`);
  return found.user.id;
}

export async function resolveStateId(
  principal: Principal,
  teamId: string,
  ref: string,
): Promise<string> {
  const states = await listWorkflowStates(principal, teamId);
  const found = pick(states, ref, (state) => [state.id, state.name]);
  if (found === undefined) throw notFound(`No workflow state matches "${ref}" on that team.`);
  return found.id;
}

export async function resolveLabelIds(
  principal: Principal,
  refs: readonly string[],
  teamId?: string,
): Promise<string[]> {
  if (refs.length === 0) return [];
  const labels = await listLabels(principal, teamId === undefined ? {} : { teamId });
  return refs.map((ref) => {
    const found = pick(labels, ref, (label) => [label.id, label.name]);
    if (found === undefined) throw notFound(`No label matches "${ref}".`);
    return found.id;
  });
}

export async function resolveProject(principal: Principal, ref: string): Promise<ProjectRow> {
  const projects = await listProjects(principal, { includeArchived: true });
  const found = pick(projects, ref, (project) => [project.id, project.slug, project.name]);
  if (found === undefined) throw notFound(`No project matches "${ref}".`);
  return found;
}

export async function resolveCycle(
  principal: Principal,
  teamId: string,
  ref: string,
): Promise<CycleRow> {
  if (ref.trim().toLowerCase() === 'active') {
    const current = await activeCycle(principal, teamId);
    if (current === undefined) throw notFound('That team has no active cycle.');
    return current;
  }
  const cycles = await listCycles(principal, teamId);
  const found = pick(cycles, ref, (cycle) => [cycle.id, cycle.name, String(cycle.number)]);
  if (found === undefined) throw notFound(`No cycle matches "${ref}" on that team.`);
  return found;
}
