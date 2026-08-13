import type { Project } from '@/lib/query/schemas.ts';

export function projectSupportsTeam(project: Project | undefined, teamId: string): boolean {
  return (
    project !== undefined && (project.teamIds.length === 0 || project.teamIds.includes(teamId))
  );
}

export function projectsForTeam(
  projects: readonly Project[],
  teamId: string,
  selectedProjectId: string | null,
): readonly Project[] {
  return projects.filter(
    (project) => projectSupportsTeam(project, teamId) || project.id === selectedProjectId,
  );
}
