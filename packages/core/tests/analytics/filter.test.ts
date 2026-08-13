import { describe, expect, it } from 'bun:test';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
import {
  type AnalyticsResolutionContext,
  type AnalyticsSprint,
  bucketDates,
  resolveAnalyticsQuery,
} from '../../src/analytics/filter.ts';

const now = new Date('2024-03-10T16:00:00.000Z');

const currentSprint: AnalyticsSprint = {
  id: 'sprint_current',
  teamId: 'team_one',
  timezone: 'America/New_York',
  startsAt: new Date('2024-03-04T05:00:00.000Z'),
  endsAt: new Date('2024-03-18T04:00:00.000Z'),
  completedAt: null,
  archivedAt: null,
};

const previousSprint: AnalyticsSprint = {
  id: 'sprint_previous',
  teamId: 'team_one',
  timezone: 'America/New_York',
  startsAt: new Date('2024-02-19T05:00:00.000Z'),
  endsAt: new Date('2024-03-04T05:00:00.000Z'),
  completedAt: new Date('2024-03-04T05:00:00.000Z'),
  archivedAt: null,
};

const olderSprint: AnalyticsSprint = {
  id: 'sprint_older',
  teamId: 'team_one',
  timezone: 'America/New_York',
  startsAt: new Date('2024-02-05T05:00:00.000Z'),
  endsAt: new Date('2024-02-19T05:00:00.000Z'),
  completedAt: new Date('2024-02-19T05:00:00.000Z'),
  archivedAt: null,
};

function query(input: Partial<AnalyticsQuery> = {}): AnalyticsQuery {
  return analyticsQuerySchema.parse(input);
}

function context(
  cycles: readonly AnalyticsSprint[],
  overrides: Partial<AnalyticsResolutionContext> = {},
): AnalyticsResolutionContext {
  return {
    now,
    timezone: 'America/New_York',
    cycles,
    ...overrides,
  };
}

function expectRange(
  range: { readonly from: Date; readonly to: Date },
  from: string,
  to: string,
): void {
  expect(range.from.toISOString()).toBe(from);
  expect(range.to.toISOString()).toBe(to);
}

describe('resolveAnalyticsQuery', () => {
  it('uses workspace sprint history when cycle team attribution is absent', () => {
    const workspaceCurrent = { ...currentSprint, teamId: null };
    const workspacePrevious = { ...previousSprint, teamId: null };
    const resolved = resolveAnalyticsQuery(query(), context([workspacePrevious, workspaceCurrent]));

    expect(resolved.selectedSprintId).toBe(workspaceCurrent.id);
    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-19T05:00:00.000Z',
      '2024-03-04T05:00:00.000Z',
    );
  });

  it('does not treat a workspace sprint as a selected team sprint', () => {
    const workspaceCurrent = { ...currentSprint, teamId: null };
    const resolved = resolveAnalyticsQuery(
      query(),
      context([workspaceCurrent], { selectedTeamId: 'team_one' }),
    );

    expect(resolved.selectedSprintId).toBeNull();
  });

  it('uses the only active sprint as the zero-configuration range', () => {
    const resolved = resolveAnalyticsQuery(query(), context([previousSprint, currentSprint]));

    expectRange(resolved.resolvedRange, '2024-03-04T05:00:00.000Z', '2024-03-18T04:00:00.000Z');
    expect(resolved.timezone).toBe('America/New_York');
    expect(resolved.selectedSprintId).toBe('sprint_current');
    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-19T05:00:00.000Z',
      '2024-03-04T05:00:00.000Z',
    );
  });

  it('uses a trailing 30 calendar-day range when no sprint is active', () => {
    const resolved = resolveAnalyticsQuery(query(), context([previousSprint]));

    expectRange(resolved.resolvedRange, '2024-02-10T05:00:00.000Z', '2024-03-11T04:00:00.000Z');
    expect(resolved.selectedSprintId).toBeNull();
  });

  it('uses a trailing 30 calendar-day range for overlapping active teams', () => {
    const otherActiveSprint: AnalyticsSprint = {
      ...currentSprint,
      id: 'sprint_other',
      teamId: 'team_two',
      timezone: 'Asia/Kolkata',
    };

    const resolved = resolveAnalyticsQuery(
      query(),
      context([previousSprint, currentSprint, otherActiveSprint]),
    );

    expectRange(resolved.resolvedRange, '2024-02-10T05:00:00.000Z', '2024-03-11T04:00:00.000Z');
    expect(resolved.timezone).toBe('America/New_York');
    expect(resolved.selectedSprintId).toBeNull();
  });

  it('narrows overlapping active teams to a cycle selected by the query filter', () => {
    const otherActiveSprint: AnalyticsSprint = {
      ...currentSprint,
      id: 'sprint_other',
      teamId: 'team_two',
      timezone: 'Asia/Kolkata',
    };
    const resolved = resolveAnalyticsQuery(
      query({
        filter: {
          kind: 'group',
          combinator: 'and',
          children: [
            {
              kind: 'condition',
              property: 'cycle',
              operator: 'in',
              values: ['sprint_current'],
              negate: false,
            },
          ],
        },
      }),
      context([previousSprint, currentSprint, otherActiveSprint]),
    );

    expect(resolved.selectedSprintId).toBe('sprint_current');
    expectRange(resolved.resolvedRange, '2024-03-04T05:00:00.000Z', '2024-03-18T04:00:00.000Z');
  });

  it('uses selected cycle context and never compares it with another team', () => {
    const otherActiveSprint: AnalyticsSprint = {
      ...currentSprint,
      id: 'sprint_other',
      teamId: 'team_two',
    };
    const unrelatedPrevious: AnalyticsSprint = {
      ...previousSprint,
      id: 'sprint_other_previous',
      teamId: 'team_two',
      completedAt: new Date('2024-03-09T05:00:00.000Z'),
    };
    const resolved = resolveAnalyticsQuery(
      query(),
      context([currentSprint, otherActiveSprint, unrelatedPrevious], {
        selectedCycleId: 'sprint_current',
      }),
    );

    expect(resolved.selectedSprintId).toBe('sprint_current');
    expect(resolved.comparisonRange).toBeNull();
  });

  it('keeps explicit previous sprint selection and comparison in the relevant team', () => {
    const unrelatedPrevious: AnalyticsSprint = {
      ...previousSprint,
      id: 'sprint_other_previous',
      teamId: 'team_two',
      startsAt: new Date('2024-02-26T05:00:00.000Z'),
      endsAt: new Date('2024-03-09T05:00:00.000Z'),
      completedAt: new Date('2024-03-09T05:00:00.000Z'),
    };
    const selected = resolveAnalyticsQuery(
      query({ range: { preset: 'previous_sprint' }, compare: 'previous_sprint' }),
      context([olderSprint, previousSprint, currentSprint, unrelatedPrevious], {
        selectedTeamId: 'team_one',
      }),
    );
    const compared = resolveAnalyticsQuery(
      query({ range: { preset: 'last_30_days' }, compare: 'previous_sprint' }),
      context([previousSprint, currentSprint, unrelatedPrevious], {
        selectedCycleId: 'sprint_current',
      }),
    );

    expect(selected.selectedSprintId).toBe('sprint_previous');
    expectRange(
      selected.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-05T05:00:00.000Z',
      '2024-02-19T05:00:00.000Z',
    );
    expectRange(
      compared.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-19T05:00:00.000Z',
      '2024-03-04T05:00:00.000Z',
    );
  });

  it('resolves custom calendar dates as an inclusive selection and half-open UTC range', () => {
    const resolved = resolveAnalyticsQuery(
      query({
        range: { preset: 'custom', from: '2024-03-09', to: '2024-03-11' },
        compare: 'previous_period',
      }),
      context([]),
    );

    expectRange(resolved.resolvedRange, '2024-03-09T05:00:00.000Z', '2024-03-12T04:00:00.000Z');
    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-03-06T05:00:00.000Z',
      '2024-03-09T05:00:00.000Z',
    );
    expect(resolved.comparisonTo?.getTime()).toBe(resolved.from.getTime());
  });

  it('includes leap day in presets and preserves equal adjacent comparison periods', () => {
    const resolved = resolveAnalyticsQuery(
      query({ range: { preset: 'last_90_days' }, compare: 'previous_period' }),
      context([], {
        now: new Date('2024-03-01T18:00:00.000Z'),
        timezone: 'Asia/Kolkata',
      }),
    );

    expectRange(resolved.resolvedRange, '2023-12-02T18:30:00.000Z', '2024-03-01T18:30:00.000Z');
    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2023-09-03T18:30:00.000Z',
      '2023-12-02T18:30:00.000Z',
    );
  });

  it('resolves active and previous sprint selectors with sprint-local timezones', () => {
    const cycles = [olderSprint, currentSprint, previousSprint];
    const active = resolveAnalyticsQuery(
      query({ range: { preset: 'active_sprint' }, compare: 'none' }),
      context(cycles),
    );
    const previous = resolveAnalyticsQuery(
      query({ range: { preset: 'previous_sprint' }, compare: 'previous_sprint' }),
      context(cycles),
    );

    expect(active.selectedSprintId).toBe('sprint_current');
    expectRange(active.resolvedRange, '2024-03-04T05:00:00.000Z', '2024-03-18T04:00:00.000Z');
    expect(previous.selectedSprintId).toBe('sprint_previous');
    expectRange(previous.resolvedRange, '2024-02-19T05:00:00.000Z', '2024-03-04T05:00:00.000Z');
    expectRange(
      previous.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-05T05:00:00.000Z',
      '2024-02-19T05:00:00.000Z',
    );
  });

  it('uses the latest completed sprint when a date range requests sprint comparison', () => {
    const resolved = resolveAnalyticsQuery(
      query({ range: { preset: 'last_30_days' }, compare: 'previous_sprint' }),
      context([olderSprint, previousSprint]),
    );

    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2024-02-19T05:00:00.000Z',
      '2024-03-04T05:00:00.000Z',
    );
  });

  it('bounds all-time to known history and falls back to a finite window without history', () => {
    const known = resolveAnalyticsQuery(
      query({ range: { preset: 'all_time' }, compare: 'none' }),
      context([], { earliestIssueAt: new Date('2019-06-15T14:21:00.000Z') }),
    );
    const empty = resolveAnalyticsQuery(
      query({ range: { preset: 'all_time' }, compare: 'none' }),
      context([]),
    );

    expectRange(known.resolvedRange, '2019-06-15T04:00:00.000Z', '2024-03-11T04:00:00.000Z');
    expectRange(empty.resolvedRange, '2024-02-10T05:00:00.000Z', '2024-03-11T04:00:00.000Z');
  });

  it('selects day, week, and month buckets at the adaptive boundaries', () => {
    const short = resolveAnalyticsQuery(
      query({ range: { preset: 'custom', from: '2024-01-01', to: '2024-02-14' } }),
      context([], { timezone: 'UTC' }),
    );
    const medium = resolveAnalyticsQuery(
      query({ range: { preset: 'custom', from: '2024-01-01', to: '2025-03-31' } }),
      context([], { timezone: 'UTC' }),
    );
    const long = resolveAnalyticsQuery(
      query({ range: { preset: 'custom', from: '2024-01-01', to: '2025-04-01' } }),
      context([], { timezone: 'UTC' }),
    );

    expect(short.bucket).toBe('day');
    expect(medium.bucket).toBe('week');
    expect(long.bucket).toBe('month');
  });

  it('defends the core contract against reversed custom dates', () => {
    const invalid = {
      ...query(),
      range: { preset: 'custom', from: '2024-03-11', to: '2024-03-09' },
    } as AnalyticsQuery;

    expect(() => resolveAnalyticsQuery(invalid, context([]))).toThrow(RangeError);
  });

  it('preserves the original query range discriminator on the resolved query', () => {
    const input = query({
      range: { preset: 'custom', from: '2024-03-09', to: '2024-03-11' },
      compare: 'none',
    });
    const resolved = resolveAnalyticsQuery(input, context([]));
    const compatible: AnalyticsQuery = resolved;

    expect(compatible.range).toEqual(input.range);
    expectRange(resolved.resolvedRange, '2024-03-09T05:00:00.000Z', '2024-03-12T04:00:00.000Z');
  });

  it('uses the first valid instant when a civil date skips midnight', () => {
    const resolved = resolveAnalyticsQuery(
      query({
        range: { preset: 'custom', from: '2018-11-04', to: '2018-11-04' },
        compare: 'previous_period',
      }),
      context([], {
        now: new Date('2018-11-04T12:00:00.000Z'),
        timezone: 'America/Sao_Paulo',
      }),
    );

    expectRange(resolved.resolvedRange, '2018-11-04T03:00:00.000Z', '2018-11-05T02:00:00.000Z');
    expectRange(
      resolved.comparisonRange as { readonly from: Date; readonly to: Date },
      '2018-11-03T03:00:00.000Z',
      '2018-11-04T03:00:00.000Z',
    );
    expect(bucketDates(resolved.resolvedRange, 'day').map((date) => date.toISOString())).toEqual([
      '2018-11-04T03:00:00.000Z',
    ]);
  });

  it('chooses the earlier instant when a civil midnight overlaps', () => {
    const resolved = resolveAnalyticsQuery(
      query({
        range: { preset: 'custom', from: '2018-11-03', to: '2018-11-05' },
        compare: 'previous_period',
      }),
      context([], {
        now: new Date('2018-11-04T12:00:00.000Z'),
        timezone: 'America/Havana',
      }),
    );

    expectRange(resolved.resolvedRange, '2018-11-03T04:00:00.000Z', '2018-11-06T05:00:00.000Z');
    expect(resolved.comparisonTo?.toISOString()).toBe('2018-11-03T04:00:00.000Z');
    expect(bucketDates(resolved.resolvedRange, 'day').map((date) => date.toISOString())).toEqual([
      '2018-11-03T04:00:00.000Z',
      '2018-11-04T04:00:00.000Z',
      '2018-11-05T05:00:00.000Z',
    ]);
  });
});

describe('bucketDates', () => {
  it('emits timezone-correct daily UTC boundaries through a DST transition', () => {
    const resolved = resolveAnalyticsQuery(
      query({ range: { preset: 'custom', from: '2024-03-09', to: '2024-03-12' } }),
      context([]),
    );

    expect(bucketDates(resolved.resolvedRange, 'day').map((date) => date.toISOString())).toEqual([
      '2024-03-09T05:00:00.000Z',
      '2024-03-10T05:00:00.000Z',
      '2024-03-11T04:00:00.000Z',
      '2024-03-12T04:00:00.000Z',
    ]);
  });

  it('never emits more than 120 buckets for a long all-time range', () => {
    const resolved = resolveAnalyticsQuery(
      query({ range: { preset: 'all_time' }, compare: 'none' }),
      context([], { earliestIssueAt: new Date('1900-01-01T12:00:00.000Z') }),
    );
    const dates = bucketDates(resolved.resolvedRange, resolved.bucket);

    expect(dates.length).toBeLessThanOrEqual(120);
    expect(dates[0]?.toISOString()).toBe('1900-01-01T05:00:00.000Z');
    expect(dates.every((date) => date < resolved.to)).toBe(true);
  });
});
