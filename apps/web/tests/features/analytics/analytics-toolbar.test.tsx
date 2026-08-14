import { describe, expect, mock, test } from 'bun:test';
import type { FilterGroup } from '@orbit/shared/filters';
import userEvent from '@testing-library/user-event';
import {
  SprintFilterSelect,
  selectedSprintId,
  withSelectedSprint,
} from '../../../src/features/analytics/analytics-toolbar.tsx';
import type { Cycle } from '../../../src/lib/query/schemas.ts';
import { render, screen } from '../../../src/test/render.tsx';

const sprintId = '019c3de7-5cb1-70cc-b6de-0018f2124260';
const projectId = '019c3de7-5cb1-70cc-b6de-0018f2124261';

const nestedFilter: FilterGroup = {
  kind: 'group',
  combinator: 'or',
  children: [
    {
      kind: 'condition',
      property: 'project',
      operator: 'in',
      values: [projectId],
      negate: false,
    },
    {
      kind: 'condition',
      property: 'priority',
      operator: 'in',
      values: ['2'],
      negate: false,
    },
  ],
};

const sprint: Cycle = {
  id: sprintId,
  teamId: null,
  number: 7,
  name: 'Q3 hardening',
  startsAt: '2026-08-10T00:00:00.000Z',
  endsAt: '2026-08-24T00:00:00.000Z',
  completedAt: null,
};

describe('SprintFilterSelect', () => {
  test('adds a sprint without changing nested Boolean filter meaning', async () => {
    const onChange = mock();
    const user = userEvent.setup();
    render(<SprintFilterSelect cycles={[sprint]} filter={nestedFilter} onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Sprint' }));
    await user.click(screen.getByRole('option', { name: 'Q3 hardening' }));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'group',
      combinator: 'and',
      children: [
        nestedFilter,
        {
          kind: 'condition',
          property: 'cycle',
          operator: 'in',
          values: [sprintId],
          negate: false,
        },
      ],
    });
  });

  test('clears only the first-class sprint selector', () => {
    const selected = withSelectedSprint(nestedFilter, sprintId);

    expect(selectedSprintId(selected)).toBe(sprintId);
    expect(withSelectedSprint(selected, null)).toEqual(nestedFilter);
  });
});
