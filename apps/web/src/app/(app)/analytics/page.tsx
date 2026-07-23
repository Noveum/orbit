import type { Measure } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { CyclePanel } from '@/features/analytics/cycle-panel.tsx';
import { loadDashboard } from '@/features/analytics/data.ts';
import { STATE_GROUP_ORDER, stateGroupLabel } from '@/features/analytics/labels.ts';
import { MeasureToggle } from '@/features/analytics/measure-toggle.tsx';
import { SavedViewBar } from '@/features/analytics/saved-view-bar.tsx';
import { BarChart } from '@/features/charts/bar-chart.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Analytics' };

interface PageProps {
  readonly searchParams: Promise<{ measure?: string }>;
}

function Card({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {title === undefined ? null : <h2 className="font-medium text-dense text-text">{title}</h2>}
      {children}
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { measure: rawMeasure } = await searchParams;
  const measure: Measure = rawMeasure === 'points' ? 'points' : 'issues';
  const { principal } = await pageContext();
  const dashboard = await loadDashboard(principal, measure);
  const canManage = can(principal, 'view:manage');
  const valueLabel = measure === 'points' ? 'Points' : 'Issues';

  const scopeMax = Math.max(1, ...dashboard.series.map((point) => point.scope));
  const segmentKeys = STATE_GROUP_ORDER.filter((key) => key in dashboard.breakdown.schema);

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="font-semibold text-lg text-text">Analytics</h1>
            <p className="text-muted text-xs">
              Scope, throughput, churn and distributions across the workspace.
            </p>
          </div>
          <MeasureToggle measure={measure} />
        </div>
        <SavedViewBar views={dashboard.savedViews} measure={measure} canManage={canManage} />
      </header>

      <Card title="Scope and completed over time">
        {dashboard.series.length === 0 ? (
          <p className="py-6 text-center text-faint text-xs">
            No issues yet, so there is nothing to plot.
          </p>
        ) : (
          <LineChart
            title=""
            description={`Scope grew to ${dashboard.series.at(-1)?.scope ?? 0} ${valueLabel.toLowerCase()}, ${dashboard.series.at(-1)?.completed ?? 0} completed.`}
            max={scopeMax}
            labels={dashboard.series.map((point) => point.date)}
            series={[
              {
                id: 'scope',
                label: 'Scope',
                tone: 'faint',
                values: dashboard.series.map((point) => point.scope),
              },
              {
                id: 'completed',
                label: 'Completed',
                tone: 'accent',
                filled: true,
                values: dashboard.series.map((point) => point.completed),
              },
            ]}
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <BarChart
            title="By assignee"
            description={`${valueLabel} per assignee.`}
            valueLabel={valueLabel}
            data={dashboard.byAssignee}
          />
        </Card>
        <Card>
          <BarChart
            title="By project"
            description={`${valueLabel} per project.`}
            valueLabel={valueLabel}
            data={dashboard.byProject}
          />
        </Card>
        <Card>
          <BarChart
            title="By label"
            description={`${valueLabel} per label. Issues with several labels count in each.`}
            valueLabel={valueLabel}
            data={dashboard.byLabel}
          />
        </Card>
        <Card>
          <BarChart
            title="Estimate distribution"
            description={`${valueLabel} per estimate.`}
            valueLabel={valueLabel}
            data={dashboard.byEstimate}
          />
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-dense text-text">Assignee breakdown by state</h2>
          <a
            href={`/api/analytics/export?dimension=assignee&measure=${measure}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-2xs text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-xs">
            <thead>
              <tr className="border-border border-b text-2xs text-faint uppercase">
                <th scope="col" className="px-2 py-2 text-left font-medium">
                  Assignee
                </th>
                {segmentKeys.map((key) => (
                  <th key={key} scope="col" className="px-2 py-2 text-right font-medium">
                    {stateGroupLabel(key)}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {dashboard.breakdown.data.length === 0 ? (
                <tr>
                  <td colSpan={segmentKeys.length + 2} className="px-2 py-4 text-center text-faint">
                    No issues in range.
                  </td>
                </tr>
              ) : (
                dashboard.breakdown.data.map((row) => (
                  <tr key={row.key} className="border-border border-b last:border-b-0">
                    <td className="px-2 py-1.5 text-muted">{row.name}</td>
                    {segmentKeys.map((key) => (
                      <td key={key} className="px-2 py-1.5 text-right text-muted tabular">
                        {row.values[key] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-medium text-text tabular">
                      {row.total}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CyclePanel cycles={dashboard.cycles} measure={measure} canManage={canManage} />
    </div>
  );
}
