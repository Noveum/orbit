import { CURRENT_SPRINT_FILTER_VALUE } from '@orbit/shared/filters';
import { sprintLabel } from '@orbit/shared/utils';
import type { Cycle } from './query/schemas.ts';

export function sprintOptions(cycles: readonly Cycle[], now = Date.now()) {
  return cycles
    .filter((cycle) => cycle.completedAt === null && new Date(cycle.endsAt).getTime() > now)
    .toSorted((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((cycle) => ({
      id: cycle.id,
      label:
        new Date(cycle.startsAt).getTime() <= now
          ? `Current sprint (${sprintLabel(cycle)})`
          : sprintLabel(cycle),
    }));
}

export function sprintFilterOptions(cycles: readonly Cycle[], now = Date.now()) {
  const available = sprintOptions(cycles, now);
  const currentIds = new Set(
    cycles.filter((cycle) => new Date(cycle.startsAt).getTime() <= now).map((cycle) => cycle.id),
  );
  const current = available.filter((cycle) => currentIds.has(cycle.id));
  return [
    {
      id: CURRENT_SPRINT_FILTER_VALUE,
      label: current[0]?.label ?? 'Current sprint',
      facetValues: current.map((cycle) => cycle.id),
    },
    ...available.filter((cycle) => !currentIds.has(cycle.id)),
  ];
}
