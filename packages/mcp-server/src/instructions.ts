import { getOrganization, getProject, getTeam } from '@orbit/core';
import { isDomainError } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';

export function layerInstructions(layers: {
  readonly workspace?: string | null | undefined;
  readonly team?: string | null | undefined;
  readonly project?: string | null | undefined;
}): string {
  const sections: string[] = [];
  const ws = layers.workspace?.trim();
  if (ws !== undefined && ws.length > 0) {
    sections.push(`## Workspace\n\n${ws}`);
  }
  const tm = layers.team?.trim();
  if (tm !== undefined && tm.length > 0) {
    sections.push(`## Team\n\n${tm}`);
  }
  const pr = layers.project?.trim();
  if (pr !== undefined && pr.length > 0) {
    sections.push(`## Project\n\n${pr}`);
  }
  return sections.join('\n\n');
}

async function optionalProjectInstructions(
  principal: Principal,
  projectId: string | null,
): Promise<string | undefined> {
  if (projectId === null) return undefined;
  try {
    return (await getProject(principal, projectId)).instructions;
  } catch (error) {
    if (isDomainError(error) && error.code === 'not_found') return undefined;
    throw error;
  }
}

export async function resolveIssueInstructions(
  principal: Principal,
  issue: { readonly teamId: string; readonly projectId: string | null },
): Promise<string> {
  const [organization, team, projectInstructions] = await Promise.all([
    getOrganization(principal.organizationId),
    getTeam(principal, issue.teamId),
    optionalProjectInstructions(principal, issue.projectId),
  ]);

  return layerInstructions({
    workspace: organization.agentInstructions,
    team: team.instructions,
    project: projectInstructions,
  });
}
