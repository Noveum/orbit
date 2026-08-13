'use client';

import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { AnalyticsCard } from './analytics-card.tsx';
import { AnalyticsDrilldownDialog } from './analytics-drilldown-dialog.tsx';
import { BarPlot } from './charts/bar-plot.tsx';
import { LinePlot } from './charts/line-plot.tsx';
import type { AnalyticsOverviewResponse } from './contracts.ts';

interface EvidenceSelection {
  readonly title: string;
  readonly cohort: AnalyticsDrilldownCohort;
}

function valueLabel(value: number, unit: string): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit === 'days' ? `${formatted}d` : formatted;
}

export function OverviewLens({
  data,
  query,
}: {
  readonly data: AnalyticsOverviewResponse;
  readonly query: AnalyticsQuery;
}) {
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const activate = (title: string, cohort: AnalyticsDrilldownCohort) =>
    setEvidence({ title, cohort });
  const deliverySeries = [
    {
      id: 'created',
      label: 'Created',
      points: data.delivery.map((point) => ({
        id: `${point.date}-created`,
        label: point.date,
        value: point.created,
        cohort: point.createdCohort,
      })),
    },
    {
      id: 'completed',
      label: 'Completed',
      points: data.delivery.map((point) => ({
        id: `${point.date}-completed`,
        label: point.date,
        value: point.completed,
        cohort: point.completedCohort,
      })),
    },
    {
      id: 'open',
      label: 'Open',
      points: data.delivery.map((point) => ({
        id: `${point.date}-open`,
        label: point.date,
        value: point.open,
        cohort: point.openCohort,
      })),
    },
  ];
  const distributions = [
    { title: 'Workflow state', points: data.state },
    { title: 'Projects', points: data.projects },
    { title: 'Priority', points: data.priorities },
  ];
  const deliveryTotals = data.delivery.reduce(
    (total, point) => ({
      created: total.created + point.created,
      completed: total.completed + point.completed,
      open: point.open,
    }),
    { created: 0, completed: 0, open: 0 },
  );

  return (
    <div className="grid gap-4">
      <div className="flex snap-x gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {data.cards.map((card) => (
          <button
            aria-label={`${card.label}, ${valueLabel(card.value, card.unit)} ${card.unit}`}
            className="min-w-40 snap-start rounded-lg border border-border bg-surface p-4 text-left transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            key={card.id}
            onClick={() => activate(card.label, card.cohort)}
            type="button"
          >
            <span className="text-muted text-xs">{card.label}</span>
            <span className="mt-2 flex items-baseline gap-2">
              <span className="font-semibold text-2xl text-text">
                {valueLabel(card.value, card.unit)}
              </span>
              {card.comparisonDelta === null ? null : (
                <span className="text-faint text-xs">
                  {card.comparisonDelta > 0 ? '+' : ''}
                  {valueLabel(card.comparisonDelta, card.unit)}
                </span>
              )}
            </span>
            <span className="mt-1 block text-faint text-2xs uppercase">{card.unit}</span>
          </button>
        ))}
      </div>

      <AnalyticsCard title="Delivery trend">
        {data.delivery.length === 0 ? (
          <p className="py-12 text-center text-muted text-sm">
            Delivery activity will appear as work moves.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 rounded-md bg-surface-2 p-3 text-center">
              <div>
                <p className="font-semibold text-text" data-testid="delivery-created">
                  {deliveryTotals.created}
                </p>
                <p className="text-faint text-xs">Created</p>
              </div>
              <div>
                <p className="font-semibold text-text" data-testid="delivery-completed">
                  {deliveryTotals.completed}
                </p>
                <p className="text-faint text-xs">Completed</p>
              </div>
              <div>
                <p className="font-semibold text-text" data-testid="delivery-open">
                  {deliveryTotals.open}
                </p>
                <p className="text-faint text-xs">Open now</p>
              </div>
            </div>
            <LinePlot
              label="Created, completed, and open work"
              onActivate={(cohort) => activate('Delivery evidence', cohort)}
              series={deliverySeries}
            />
          </>
        )}
      </AnalyticsCard>

      <div className="grid gap-4 lg:grid-cols-3">
        {distributions.map((distribution) => (
          <AnalyticsCard key={distribution.title} title={distribution.title}>
            {distribution.points.length === 0 ? (
              <p className="py-8 text-center text-muted text-xs">No matching work.</p>
            ) : (
              <BarPlot
                label={distribution.title}
                onActivate={(cohort) => activate(distribution.title, cohort)}
                points={distribution.points}
              />
            )}
          </AnalyticsCard>
        ))}
      </div>

      {data.outliers.length === 0 ? null : (
        <AnalyticsCard title="Longest cycle time">
          <div className="divide-y divide-border">
            {data.outliers.map((outlier) => (
              <button
                className="flex w-full items-center justify-between gap-4 px-2 py-2 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                key={outlier.issueId}
                onClick={() => activate(outlier.title, outlier.cohort)}
                type="button"
              >
                <span className="min-w-0 truncate text-sm text-text">
                  <span className="mr-2 text-faint">{outlier.identifier}</span>
                  {outlier.title}
                </span>
                <span className="shrink-0 text-muted text-xs tabular">
                  {valueLabel(outlier.cycleTimeDays, 'days')}
                </span>
              </button>
            ))}
          </div>
        </AnalyticsCard>
      )}

      {evidence === null ? null : (
        <AnalyticsDrilldownDialog
          cohort={evidence.cohort}
          onOpenChange={(open) => {
            if (!open) setEvidence(null);
          }}
          open
          query={query}
          title={evidence.title}
        />
      )}
    </div>
  );
}
