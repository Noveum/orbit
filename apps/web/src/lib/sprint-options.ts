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
