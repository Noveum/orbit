import type { Measure } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { AnalyticsCard } from './analytics-card.tsx';
import { loadScopeSeries } from './data.ts';

export async function ScopeSection({
  principal,
  measure,
}: {
  readonly principal: Principal;
  readonly measure: Measure;
}) {
  const series = await loadScopeSeries(principal, measure);
  const valueLabel = measure === 'points' ? 'Points' : 'Issues';
  const scopeMax = Math.max(1, ...series.map((point) => point.scope));

  return (
    <AnalyticsCard title="Scope and completed over time">
      {series.length === 0 ? (
        <p className="py-6 text-center text-faint text-xs">
          No issues yet, so there is nothing to plot.
        </p>
      ) : (
        <LineChart
          title=""
          description={`Scope grew to ${series.at(-1)?.scope ?? 0} ${valueLabel.toLowerCase()}, ${series.at(-1)?.completed ?? 0} completed.`}
          max={scopeMax}
          labels={series.map((point) => point.date)}
          series={[
            {
              id: 'scope',
              label: 'Scope',
              tone: 'faint',
              values: series.map((point) => point.scope),
            },
            {
              id: 'completed',
              label: 'Completed',
              tone: 'accent',
              filled: true,
              values: series.map((point) => point.completed),
            },
          ]}
        />
      )}
    </AnalyticsCard>
  );
}
