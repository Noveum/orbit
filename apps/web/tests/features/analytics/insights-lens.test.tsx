import { afterEach, describe, expect, mock, test } from 'bun:test';
import { analyticsQuerySchema, insightConfigSchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsInsightsResponse } from '../../../src/features/analytics/contracts.ts';
import { InsightsLens } from '../../../src/features/analytics/insights-lens.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const originalFetch = globalThis.fetch;
const query = analyticsQuerySchema.parse({});
const defaultInsight = insightConfigSchema.parse({});

const barsData: AnalyticsInsightsResponse = {
  kind: 'bars',
  unit: 'issues',
  buckets: [
    { id: 's1', label: 'In progress', value: 5, segments: [], cohort: { cohort: 'state:s1' } },
    { id: 's2', label: 'Done', value: 3, segments: [], cohort: { cohort: 'state:s2' } },
  ],
};

const scatterData: AnalyticsInsightsResponse = {
  kind: 'scatter',
  unit: 'days',
  points: [{ issueId: 'i1', identifier: 'ORB-1', title: 'Fix the thing', days: 4.2 }],
  percentiles: { p25: 1, p50: 2, p75: 3, p95: 4 },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('InsightsLens', () => {
  test('renders the three pickers and a bar chart from a bars response', () => {
    render(
      <InsightsLens
        data={barsData}
        insight={defaultInsight}
        onInsightChange={mock()}
        query={query}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Insight measure' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Insight slice' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Insight segment' })).toBeVisible();
    expect(screen.getByRole('application', { name: 'Count by State category' })).toBeVisible();
    expect(screen.getByTestId('plot-category-s1')).toHaveTextContent('In progress');
  });

  test('switching measure to cycle_time asks the parent to fetch scatter data, which then renders as a scatterplot', async () => {
    const user = userEvent.setup();
    const onInsightChange = mock();
    const { rerender } = render(
      <InsightsLens
        data={barsData}
        insight={defaultInsight}
        onInsightChange={onInsightChange}
        query={query}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Insight measure' }));
    await user.click(screen.getByRole('option', { name: 'Cycle time' }));

    expect(onInsightChange).toHaveBeenCalledWith({
      measure: 'cycle_time',
      slice: 'state_category',
      cumulative: false,
    });

    rerender(
      <InsightsLens
        data={scatterData}
        insight={{ measure: 'cycle_time', slice: 'state_category', cumulative: false }}
        onInsightChange={onInsightChange}
        query={query}
      />,
    );

    expect(screen.getByRole('application', { name: 'Cycle time distribution' })).toBeVisible();
    expect(screen.queryByTestId('plot-category-s1')).not.toBeInTheDocument();
  });

  test('clears the segment when the slice picker is changed to match it, instead of producing an invalid config', async () => {
    const user = userEvent.setup();
    const onInsightChange = mock();
    const insight = {
      measure: 'count' as const,
      slice: 'state_category' as const,
      segment: 'assignee' as const,
      cumulative: false,
    };
    render(
      <InsightsLens
        data={barsData}
        insight={insight}
        onInsightChange={onInsightChange}
        query={query}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Insight slice' }));
    await user.click(screen.getByRole('option', { name: 'Assignee' }));

    expect(onInsightChange).toHaveBeenCalledWith({
      measure: 'count',
      slice: 'assignee',
      cumulative: false,
    });
  });

  test('clicking a bucket with a cohort opens the drilldown dialog for that cohort', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            predicate: 'state:s1',
            total: 5,
            totalValue: 5,
            details: { validCycleCount: 0, cycleTimeP50: null, cycleTimeP85: null },
            issues: [],
            nextCursor: null,
            limit: 50,
            asOf: '2026-08-15T00:00:00.000Z',
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-15T00:00:00.000Z',
            timezone: 'UTC',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    const insight = { measure: 'count' as const, slice: 'state' as const, cumulative: false };
    render(
      <InsightsLens data={barsData} insight={insight} onInsightChange={mock()} query={query} />,
    );

    await user.click(screen.getByTestId('plot-hit-s1'));

    expect(await screen.findByRole('dialog', { name: 'Count by State' })).toBeVisible();
    expect(screen.getByText(/Predicate: state:s1/)).toBeVisible();
  });

  test('leaves the null-cohort overflow bucket without a drilldown action', async () => {
    const user = userEvent.setup();
    const data: AnalyticsInsightsResponse = {
      kind: 'bars',
      unit: 'issues',
      buckets: [
        ...(barsData.kind === 'bars' ? barsData.buckets : []),
        { id: 'other', label: 'Other', value: 1, segments: [], cohort: null },
      ],
    };
    render(
      <InsightsLens data={data} insight={defaultInsight} onInsightChange={mock()} query={query} />,
    );

    await user.click(screen.getByTestId('plot-hit-other'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('stacks one rect per segment when the response carries segment breakdowns', () => {
    const data: AnalyticsInsightsResponse = {
      kind: 'bars',
      unit: 'issues',
      buckets: [
        {
          id: 's1',
          label: 'In progress',
          value: 5,
          segments: [
            { id: 'alice', label: 'Alice', value: 3 },
            { id: 'bob', label: 'Bob', value: 2 },
          ],
          cohort: { cohort: 'state:s1' },
        },
      ],
    };
    render(
      <InsightsLens data={data} insight={defaultInsight} onInsightChange={mock()} query={query} />,
    );

    const svg = screen.getByRole('application', { name: 'Count by State category' });
    const segmentRects = svg.querySelectorAll('rect[fill^="var(--analytics-series-"]');
    expect(segmentRects).toHaveLength(2);
  });

  test('renders a cumulative line for completed_week when the toggle is on, summing week over week', async () => {
    const user = userEvent.setup();
    const data: AnalyticsInsightsResponse = {
      kind: 'bars',
      unit: 'issues',
      buckets: [
        {
          id: '2026-08-10',
          label: '2026-08-10',
          value: 5,
          segments: [],
          cohort: { cohort: 'completed-week:2026-08-10' },
        },
        {
          id: '2026-07-27',
          label: '2026-07-27',
          value: 3,
          segments: [],
          cohort: { cohort: 'completed-week:2026-07-27' },
        },
        {
          id: '2026-08-03',
          label: '2026-08-03',
          value: 2,
          segments: [],
          cohort: { cohort: 'completed-week:2026-08-03' },
        },
      ],
    };
    const insight = {
      measure: 'count' as const,
      slice: 'completed_week' as const,
      cumulative: true,
    };
    render(<InsightsLens data={data} insight={insight} onInsightChange={mock()} query={query} />);

    expect(screen.getByTestId('plot-line-cumulative')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-hit-s1')).not.toBeInTheDocument();

    await user.hover(screen.getByTestId('plot-hit-2026-08-10'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('10');
  });

  test('shows an honest empty state when there are no buckets', () => {
    const data: AnalyticsInsightsResponse = { kind: 'bars', unit: 'issues', buckets: [] };
    render(
      <InsightsLens data={data} insight={defaultInsight} onInsightChange={mock()} query={query} />,
    );

    expect(screen.getByText('No matching issues for this insight.')).toBeVisible();
  });

  test('disables the segment picker to None for a duration measure like cycle time', () => {
    const insight = {
      measure: 'cycle_time' as const,
      slice: 'state_category' as const,
      cumulative: false,
    };
    render(
      <InsightsLens data={scatterData} insight={insight} onInsightChange={mock()} query={query} />,
    );

    const segmentPicker = screen.getByRole('combobox', { name: 'Insight segment' });
    expect(segmentPicker).toBeDisabled();
    expect(segmentPicker).toHaveTextContent('No segment');
  });

  test('leaves the segment picker enabled for a count measure', () => {
    render(
      <InsightsLens
        data={barsData}
        insight={defaultInsight}
        onInsightChange={mock()}
        query={query}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Insight segment' })).toBeEnabled();
  });

  test('shows the label overlap caption only when segmenting by label', () => {
    const withLabelSegment = {
      measure: 'count' as const,
      slice: 'state_category' as const,
      segment: 'label' as const,
      cumulative: false,
    };
    const caption = 'Issues can carry several labels, so label segments may overlap.';
    const { rerender } = render(
      <InsightsLens
        data={barsData}
        insight={withLabelSegment}
        onInsightChange={mock()}
        query={query}
      />,
    );
    expect(screen.getByText(caption)).toBeVisible();

    const withAssigneeSegment = {
      measure: 'count' as const,
      slice: 'state_category' as const,
      segment: 'assignee' as const,
      cumulative: false,
    };
    rerender(
      <InsightsLens
        data={barsData}
        insight={withAssigneeSegment}
        onInsightChange={mock()}
        query={query}
      />,
    );
    expect(screen.queryByText(caption)).not.toBeInTheDocument();
  });
});
