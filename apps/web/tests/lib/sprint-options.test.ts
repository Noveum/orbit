import { describe, expect, it } from 'bun:test';
import type { Cycle } from '../../src/lib/query/schemas.ts';
import { sprintOptions } from '../../src/lib/sprint-options.ts';

const now = Date.parse('2026-09-10T00:00:00Z');
function cycle(
  number: number,
  startsAt: string,
  endsAt: string,
  completedAt: string | null = null,
): Cycle {
  return { id: String(number), teamId: null, number, name: '', startsAt, endsAt, completedAt };
}
const previous = cycle(1, '2026-09-03', '2026-09-10');
const current = cycle(2, '2026-09-10', '2026-09-17');
const future = cycle(3, '2026-09-17', '2026-09-24');

describe('sprintOptions', () => {
  it('hides expired and completed sprints and labels the current sprint', () => {
    expect(
      sprintOptions(
        [future, previous, current, { ...future, id: 'closed', completedAt: '2026-09-09' }],
        now,
      ),
    ).toEqual([
      { id: '2', label: 'Current sprint (Sprint 2)' },
      { id: '3', label: 'Sprint 3' },
    ]);
  });
  it('advances the current option at the next boundary', () => {
    expect(sprintOptions([previous, current, future], Date.parse(current.endsAt))).toEqual([
      { id: '3', label: 'Current sprint (Sprint 3)' },
    ]);
  });
});
