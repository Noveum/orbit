import type { Project, Team, View } from '@/lib/query/schemas.ts';

export const VIEW_SCOPE_MISSES = ['project', 'team'] as const;

export type ViewScopeMiss = (typeof VIEW_SCOPE_MISSES)[number];

const MISS_LABELS: Record<ViewScopeMiss, string> = {
  project: 'saved project unavailable',
  team: 'saved team unavailable',
};

export const WORKSPACE_SCOPE_NAME = 'Workspace';

export interface ViewScopeSource {
  readonly teams: readonly Team[];
  readonly projects: readonly Project[];
}

export interface ResolvedViewScope {
  readonly team: Team | null;
  readonly project: Project | null;
  readonly query: Readonly<Record<string, string>>;
  readonly name: string;
  readonly label: string;
  readonly unresolved: readonly ViewScopeMiss[];
}

function scopeQuery(team: Team | null, project: Project | null): Record<string, string> {
  const query: Record<string, string> = {};
  if (team !== null) query['teamId'] = team.id;
  if (project !== null) query['projectId'] = project.id;
  return query;
}

function scopeLabel(name: string, unresolved: readonly ViewScopeMiss[]): string {
  if (unresolved.length === 0) return name;
  return `${name}, ${unresolved.map((miss) => MISS_LABELS[miss]).join(' and ')}`;
}

export function resolveViewScope(view: View, source: ViewScopeSource): ResolvedViewScope {
  const teamId = view.filter.teamId;
  const projectId = view.filter.projectId;
  const team = teamId === null ? null : (source.teams.find((entry) => entry.id === teamId) ?? null);
  const project =
    projectId === null ? null : (source.projects.find((entry) => entry.id === projectId) ?? null);

  const unresolved = VIEW_SCOPE_MISSES.filter((miss) =>
    miss === 'team' ? teamId !== null && team === null : projectId !== null && project === null,
  );
  const name = project?.name ?? team?.name ?? WORKSPACE_SCOPE_NAME;

  return {
    team,
    project,
    query: scopeQuery(team, project),
    name,
    label: scopeLabel(name, unresolved),
    unresolved,
  };
}
