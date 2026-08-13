import { afterAll, describe, expect, mock, test } from 'bun:test';
import * as coreModule from '@orbit/core';
import { analyticsQuerySchema } from '@orbit/shared/validators';

const realCore = { ...coreModule };
const selectedSprintId = '00000000-0000-7000-8000-000000000001';
const principal = {
  userId: '00000000-0000-7000-8000-000000000010',
  organizationId: '00000000-0000-7000-8000-000000000011',
  role: 'admin' as const,
  teamIds: [],
};
let receivedContext: unknown = null;
let receivedQuery: unknown = null;

mock.module('@orbit/core', () => ({
  ...realCore,
  loadSprintAnalytics: (_principal: unknown, query: unknown, context: unknown) => {
    receivedContext = context;
    receivedQuery = query;
    return Promise.resolve({
      selected: null,
      current: null,
      previous: null,
      velocity: [],
      flow: {
        leadTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
        cycleTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
        completed: 0,
        leadTimeCoverage: 'unavailable',
        cycleTimeCoverage: 'unavailable',
      },
      focus: null,
      coverage: { kind: 'live', from: null, asOf: new Date('2026-08-14T10:00:00.000Z') },
      formulas: {
        planned: 'planned',
        scope: 'scope',
        burn: 'burn',
        leadTime: 'lead',
        cycleTime: 'cycle',
        points: 'points',
        coverage: 'coverage',
      },
    });
  },
}));

afterAll(() => {
  mock.module('@orbit/core', () => realCore);
});

describe('selected sprint analytics data', () => {
  test('passes the page sprint into the shared sprint truth', async () => {
    const { loadSelectedSprintAnalyticsData } = await import(
      '../../../src/features/analytics/data.ts'
    );
    const result = await loadSelectedSprintAnalyticsData(
      principal,
      analyticsQuerySchema.parse({ lens: 'sprints' }),
      selectedSprintId,
    );

    expect(receivedContext).toEqual({ selectedSprintId });
    expect(receivedQuery).toMatchObject({ focus: { personId: principal.userId } });
    expect(result.lens).toBe('sprints');
  });

  test('keeps the current user focus when an assignee appears inside a non-constraining OR', async () => {
    const { loadSelectedSprintAnalyticsData } = await import(
      '../../../src/features/analytics/data.ts'
    );
    await loadSelectedSprintAnalyticsData(
      principal,
      analyticsQuerySchema.parse({
        lens: 'sprints',
        filter: {
          kind: 'group',
          combinator: 'or',
          children: [
            {
              kind: 'condition',
              property: 'assignee',
              operator: 'in',
              values: ['00000000-0000-7000-8000-000000000099'],
              negate: false,
            },
            {
              kind: 'condition',
              property: 'project',
              operator: 'in',
              values: ['00000000-0000-7000-8000-000000000098'],
              negate: false,
            },
          ],
        },
      }),
      selectedSprintId,
    );

    expect(receivedQuery).toMatchObject({ focus: { personId: principal.userId } });
  });
});
