import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import * as dataModule from '@/features/analytics/data.ts';
import * as handlerModule from '@/lib/api/handler.ts';
import { QueryProvider } from '@/lib/query/provider.tsx';
import { analyticsKeys } from '../../../../src/features/analytics/analytics-keys.ts';

const DATA_MODULE = '@/features/analytics/data.ts';
const HANDLER_MODULE = '@/lib/api/handler.ts';
const realData = { ...dataModule };
const realHandler = { ...handlerModule };
const query = analyticsQuerySchema.parse({});
const payload = {
  lens: 'overview' as const,
  asOf: '2026-08-13T12:00:00.000Z',
  coverage: { kind: 'live' as const, from: null, asOf: '2026-08-13T12:00:00.000Z' },
  cards: [
    {
      id: 'throughput',
      label: 'Completed',
      value: 18,
      unit: 'issues' as const,
      comparisonDelta: 3,
      cohort: { cohort: 'completed' },
      reconciliation: { kind: 'total' as const, cohortCount: 18 },
    },
  ],
  delivery: [],
  state: [],
  projects: [],
  priorities: [],
  outliers: [],
};

let loads = 0;

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: () => '/analytics',
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

mock.module(DATA_MODULE, () => ({
  ...realData,
  dehydratedAnalyticsLens: () => {
    loads += 1;
    const client = new QueryClient();
    client.setQueryData(analyticsKeys.lens('overview', query), payload);
    return Promise.resolve(dehydrate(client));
  },
  loadSavedViews: () => Promise.resolve([]),
}));

mock.module(HANDLER_MODULE, () => ({
  ...realHandler,
  pageContext: () =>
    Promise.resolve({
      principal: {
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'admin' as const,
        teamIds: [],
      },
    }),
}));

afterAll(() => {
  mock.module(DATA_MODULE, () => realData);
  mock.module(HANDLER_MODULE, () => realHandler);
  mock.module('next/navigation', () => navigation);
});

const { default: AnalyticsPage } = await import('@/app/(app)/analytics/page.tsx');

describe('AnalyticsPage', () => {
  beforeEach(() => {
    loads = 0;
  });

  it('loads one active lens and renders useful hydrated analytics', async () => {
    render(
      <QueryProvider>{await AnalyticsPage({ searchParams: Promise.resolve({}) })}</QueryProvider>,
    );

    expect(loads).toBe(1);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('18')).toBeVisible();
    expect(screen.queryByText('Analytics data is ready.')).not.toBeInTheDocument();
  });
});
