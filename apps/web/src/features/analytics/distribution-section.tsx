import type { Measure } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { BarChart } from '@/features/charts/bar-chart.tsx';
import { AnalyticsCard } from './analytics-card.tsx';
import { loadDistributions } from './data.ts';

export async function DistributionSection({
  principal,
  measure,
}: {
  readonly principal: Principal;
  readonly measure: Measure;
}) {
  const { byAssignee, byProject, byLabel, byEstimate } = await loadDistributions(
    principal,
    measure,
  );
  const valueLabel = measure === 'points' ? 'Points' : 'Issues';

  return (
    <div className="grid gap-4 lg:grid-cols-2 4xl:grid-cols-4">
      <AnalyticsCard>
        <BarChart
          title="By assignee"
          description={`${valueLabel} per assignee.`}
          valueLabel={valueLabel}
          data={byAssignee}
        />
      </AnalyticsCard>
      <AnalyticsCard>
        <BarChart
          title="By project"
          description={`${valueLabel} per project.`}
          valueLabel={valueLabel}
          data={byProject}
        />
      </AnalyticsCard>
      <AnalyticsCard>
        <BarChart
          title="By label"
          description={`${valueLabel} per label. Issues with several labels count in each.`}
          valueLabel={valueLabel}
          data={byLabel}
        />
      </AnalyticsCard>
      <AnalyticsCard>
        <BarChart
          title="Estimate distribution"
          description={`${valueLabel} per estimate.`}
          valueLabel={valueLabel}
          data={byEstimate}
        />
      </AnalyticsCard>
    </div>
  );
}
