import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SavedAnalyticsViewPayload } from '@orbit/core';
import { analyticsQuerySchema, insightConfigSchema } from '@orbit/shared/validators';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import { ToastProvider } from '@/components/ui/toast.tsx';
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
const insightsPayload = {
  kind: 'bars' as const,
  unit: 'issues' as const,
  buckets: [{ id: 'a1', label: 'Ada', value: 4, segments: [], cohort: { cohort: 'assignee:a1' } }],
};

let loads = 0;
let savedViewsOverride: SavedAnalyticsViewPayload[] = [];
let recordedInsight: unknown = null;

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
  dehydratedAnalyticsInsights: (
    _principal: unknown,
    insightsQuery: { readonly insight: unknown },
  ) => {
    loads += 1;
    recordedInsight = insightsQuery.insight;
    const client = new QueryClient();
    client.setQueryData(
      analyticsKeys.insights(insightsQuery as Parameters<typeof analyticsKeys.insights>[0]),
      insightsPayload,
    );
    return Promise.resolve(dehydrate(client));
  },
  loadSavedViews: () => Promise.resolve(savedViewsOverride),
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
    savedViewsOverride = [];
    recordedInsight = null;
  });

  it('loads one active lens and renders useful hydrated analytics', async () => {
    render(
      <QueryProvider>
        <ToastProvider>{await AnalyticsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>
      </QueryProvider>,
    );

    expect(loads).toBe(1);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('18')).toBeVisible();
    expect(screen.queryByText('Analytics data is ready.')).not.toBeInTheDocument();
  });

  it('restores a pinned insights view from its stored insight config on a clean URL', async () => {
    const pinnedInsight = insightConfigSchema.parse({ measure: 'points', slice: 'assignee' });
    savedViewsOverride = [
      {
        id: 'pinned_1',
        name: 'Points by assignee',
        scopeType: 'workspace',
        scopeId: null,
        kind: 'dashboard',
        config: {
          kind: 'dashboard',
          version: 1,
          query: analyticsQuerySchema.parse({ lens: 'insights' }),
          insight: pinnedInsight,
          pinned: true,
        },
        shared: false,
        ownerId: 'user-1',
        createdAt: '2026-08-13T12:00:00.000Z',
        updatedAt: '2026-08-13T12:00:00.000Z',
      },
    ];

    render(
      <QueryProvider>
        <ToastProvider>{await AnalyticsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>
      </QueryProvider>,
    );

    expect(recordedInsight).toEqual(pinnedInsight);
    expect(screen.getByRole('combobox', { name: 'Insight measure' })).toHaveTextContent('Points');
    expect(screen.getByRole('combobox', { name: 'Insight slice' })).toHaveTextContent('Assignee');
    expect(screen.getByRole('application', { name: 'Points by Assignee' })).toBeVisible();
  });
});
