import type { ViewVisibility } from '@orbit/shared/filters';
import { VIEW_VISIBILITIES, VIEW_VISIBILITY_LABELS } from '@orbit/shared/filters';

export interface AudienceTeam {
  readonly id: string;
  readonly name: string;
}

export interface VisibilityChoice {
  readonly value: ViewVisibility;
  readonly label: string;
}

export function audienceTeam(
  teams: readonly AudienceTeam[],
  teamId: string | null,
): AudienceTeam | null {
  if (teamId === null) return null;
  return teams.find((team) => team.id === teamId) ?? null;
}

export function visibilityChoices(team: AudienceTeam | null): VisibilityChoice[] {
  return VIEW_VISIBILITIES.filter((value) => value !== 'team' || team !== null).map((value) => ({
    value,
    label:
      value === 'team' && team !== null
        ? `Everyone on ${team.name}`
        : VIEW_VISIBILITY_LABELS[value],
  }));
}

export function allowedVisibility(
  chosen: ViewVisibility,
  team: AudienceTeam | null,
): ViewVisibility {
  return visibilityChoices(team).some((choice) => choice.value === chosen) ? chosen : 'private';
}
