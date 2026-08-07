import type { ViewPage } from '@/features/filters/view-config.ts';
import type { Project, Team, View } from '@/lib/query/schemas.ts';

const WORKSPACE_SCOPE_LABEL = 'Workspace';

export interface ViewScopeSource {
  readonly teams: readonly Team[];
  readonly projects: readonly Project[];
}

export interface ResolvedViewScope {
  readonly team: Team | null;
  readonly teamId: string | null;
  readonly params: Readonly<Record<string, string>>;
  readonly label: string;
  readonly page: ViewPage;
}

function reachable<T extends { readonly id: string }>(
  entries: readonly T[],
  id: string | null,
): T | null {
  if (id === null) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}

export function resolveViewScope(view: View, source: ViewScopeSource): ResolvedViewScope {
  const project = reachable(source.projects, view.filter.projectId);
  const team = project === null ? reachable(source.teams, view.filter.teamId) : null;
  const params: Record<string, string> = {};
  if (project !== null) params['projectId'] = project.id;
  if (team !== null) params['teamId'] = team.id;
  return {
    team,
    teamId: team?.id ?? null,
    params,
    label: project?.name ?? team?.name ?? WORKSPACE_SCOPE_LABEL,
    page: project === null ? 'saved_view' : 'project',
  };
}
