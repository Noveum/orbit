import {
  listCycles,
  listIssues,
  listLabels,
  listMembers,
  listProjectsForTeams,
  listTeams,
  listWorkflowStates,
} from '@orbit/core';
import { bootstrapQuerySchema } from '@orbit/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

const BOOTSTRAP_ISSUE_LIMIT = 200;

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = bootstrapQuerySchema.parse(searchParamsOf(request));
    const teams = await listTeams(principal);
    const activeTeam = teams.find((team) => team.key === query.team) ?? teams[0] ?? null;

    const [states, cycles, labels, members, projects] = await Promise.all([
      Promise.all(teams.map((team) => listWorkflowStates(principal, team.id))),
      Promise.all(teams.map((team) => listCycles(principal, team.id))),
      listLabels(principal),
      listMembers(principal),
      listProjectsForTeams(
        principal,
        teams.map((team) => team.id),
      ),
    ]);

    const page =
      activeTeam === null
        ? { issues: [] }
        : await listIssues(principal, { teamId: activeTeam.id, limit: BOOTSTRAP_ISSUE_LIMIT });

    return {
      userId: principal.userId,
      organizationId: principal.organizationId,
      role: principal.role,
      teams,
      activeTeamId: activeTeam?.id ?? null,
      states: states.flat(),
      cycles: cycles.flat(),
      labels,
      projects,
      members: members.map((row) => ({
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        image: row.user.image,
        handle: row.user.handle,
        role: row.member.role,
      })),
      issues: await attachLabels(page.issues),
    };
  });
}
