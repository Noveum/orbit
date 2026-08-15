'use client';

import {
  type AnalyticsDrilldownCohort,
  type AnalyticsQuery,
  INSIGHT_MEASURES,
  INSIGHT_SLICES,
  type InsightConfig,
  type InsightMeasure,
  type InsightSlice,
} from '@orbit/shared/validators';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { AnalyticsCard } from './analytics-card.tsx';
import { AnalyticsDrilldownDialog } from './analytics-drilldown-dialog.tsx';
import { BarPlot, type BarPlotPoint } from './charts/bar-plot.tsx';
import type { PlotPoint } from './charts/line-plot.tsx';
import { LinePlot } from './charts/line-plot.tsx';
import { ScatterPlot } from './charts/scatter-plot.tsx';
import type { AnalyticsInsightsResponse } from './contracts.ts';

const NONE_SEGMENT = 'none';

const MEASURE_LABELS: Record<InsightMeasure, string> = {
  count: 'Count',
  points: 'Points',
  cycle_time: 'Cycle time',
  lead_time: 'Lead time',
  age: 'Age',
};

const SLICE_LABELS: Record<InsightSlice, string> = {
  assignee: 'Assignee',
  state: 'State',
  state_category: 'State category',
  project: 'Project',
  label: 'Label',
  priority: 'Priority',
  sprint: 'Sprint',
  created_week: 'Created week',
  completed_week: 'Completed week',
};

const WEEK_SLICES: ReadonlySet<InsightSlice> = new Set(['created_week', 'completed_week']);
const DURATION_MEASURES: ReadonlySet<InsightMeasure> = new Set(['cycle_time', 'lead_time', 'age']);

function valueLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function chartLabel(insight: InsightConfig): string {
  if (insight.measure === 'count' || insight.measure === 'points') {
    return `${MEASURE_LABELS[insight.measure]} by ${SLICE_LABELS[insight.slice]}`;
  }
  return `${MEASURE_LABELS[insight.measure]} distribution`;
}

function withMeasure(insight: InsightConfig, measure: InsightMeasure): InsightConfig {
  return { ...insight, measure };
}

function withSlice(insight: InsightConfig, slice: InsightSlice): InsightConfig {
  const cumulative = WEEK_SLICES.has(slice) ? insight.cumulative : false;
  if (insight.segment === undefined || insight.segment === slice) {
    return { measure: insight.measure, slice, cumulative };
  }
  return { measure: insight.measure, slice, segment: insight.segment, cumulative };
}

function withSegment(insight: InsightConfig, segment: string): InsightConfig {
  if (segment === NONE_SEGMENT) {
    return { measure: insight.measure, slice: insight.slice, cumulative: insight.cumulative };
  }
  return { ...insight, segment: segment as InsightSlice };
}

function withCumulative(insight: InsightConfig, cumulative: boolean): InsightConfig {
  return { ...insight, cumulative };
}

type BarsResult = Extract<AnalyticsInsightsResponse, { kind: 'bars' }>;
type InsightBucketWire = BarsResult['buckets'][number];

function hasCohort(
  bucket: InsightBucketWire,
): bucket is InsightBucketWire & { cohort: AnalyticsDrilldownCohort } {
  return bucket.cohort !== null;
}

function cumulativePoints(buckets: readonly InsightBucketWire[]): readonly PlotPoint[] {
  const dated = buckets
    .filter(hasCohort)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  let total = 0;
  return dated.map((bucket) => {
    total += bucket.value;
    return { id: bucket.id, label: bucket.label, value: total, cohort: bucket.cohort };
  });
}

function barPointFrom(bucket: InsightBucketWire): BarPlotPoint {
  return {
    id: bucket.id,
    label: bucket.label,
    value: bucket.value,
    cohort: bucket.cohort,
    ...(bucket.segments.length > 0 ? { segments: bucket.segments } : {}),
  };
}

interface InsightPickersProps {
  readonly insight: InsightConfig;
  readonly onInsightChange: (next: InsightConfig) => void;
}

function InsightPickers({ insight, onInsightChange }: InsightPickersProps) {
  const segmentDisabled = DURATION_MEASURES.has(insight.measure);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        onValueChange={(value) => onInsightChange(withMeasure(insight, value as InsightMeasure))}
        value={insight.measure}
      >
        <SelectTrigger aria-label="Insight measure" className="h-7 w-auto min-w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSIGHT_MEASURES.map((measure) => (
            <SelectItem key={measure} value={measure}>
              {MEASURE_LABELS[measure]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        onValueChange={(value) => onInsightChange(withSlice(insight, value as InsightSlice))}
        value={insight.slice}
      >
        <SelectTrigger aria-label="Insight slice" className="h-7 w-auto min-w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSIGHT_SLICES.map((slice) => (
            <SelectItem key={slice} value={slice}>
              {SLICE_LABELS[slice]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={segmentDisabled}
        onValueChange={(value) => onInsightChange(withSegment(insight, value))}
        value={segmentDisabled ? NONE_SEGMENT : (insight.segment ?? NONE_SEGMENT)}
      >
        <SelectTrigger aria-label="Insight segment" className="h-7 w-auto min-w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_SEGMENT}>No segment</SelectItem>
          {INSIGHT_SLICES.filter((slice) => slice !== insight.slice).map((slice) => (
            <SelectItem key={slice} value={slice}>
              {SLICE_LABELS[slice]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {WEEK_SLICES.has(insight.slice) ? (
        <label className="flex items-center gap-2 text-muted text-xs">
          <input
            checked={insight.cumulative}
            onChange={(event) =>
              onInsightChange(withCumulative(insight, event.currentTarget.checked))
            }
            type="checkbox"
          />
          Cumulative
        </label>
      ) : null}
    </div>
  );
}

interface InsightChartProps {
  readonly data: AnalyticsInsightsResponse;
  readonly insight: InsightConfig;
  readonly label: string;
  readonly onActivate: (cohort: AnalyticsDrilldownCohort) => void;
}

function InsightChart({ data, insight, label, onActivate }: InsightChartProps) {
  if (data.kind === 'scatter') {
    return (
      <ScatterPlot
        label={label}
        percentiles={data.percentiles}
        points={data.points}
        unitLabel="days"
      />
    );
  }
  if (data.buckets.length === 0) {
    return (
      <p className="py-8 text-center text-muted text-xs">No matching issues for this insight.</p>
    );
  }
  const unit = data.unit === 'points' ? 'Points' : 'Issues';
  if (insight.cumulative && WEEK_SLICES.has(insight.slice)) {
    return (
      <LinePlot
        label={label}
        onActivate={onActivate}
        series={[{ id: 'cumulative', label, points: cumulativePoints(data.buckets) }]}
        xAxisLabel="Week"
        yAxisLabel={unit}
      />
    );
  }
  return (
    <BarPlot
      label={label}
      onActivate={onActivate}
      points={data.buckets.map(barPointFrom)}
      valueFormatter={valueLabel}
      xAxisLabel={unit}
    />
  );
}

interface InsightsLensProps {
  readonly data: AnalyticsInsightsResponse;
  readonly query: AnalyticsQuery;
  readonly insight: InsightConfig;
  readonly onInsightChange: (next: InsightConfig) => void;
}

export function InsightsLens({ data, query, insight, onInsightChange }: InsightsLensProps) {
  const [evidence, setEvidence] = useState<AnalyticsDrilldownCohort | null>(null);
  const label = chartLabel(insight);

  return (
    <div className="grid gap-4">
      <AnalyticsCard title="Configure this insight">
        <InsightPickers insight={insight} onInsightChange={onInsightChange} />
      </AnalyticsCard>

      <AnalyticsCard title={label}>
        <InsightChart data={data} insight={insight} label={label} onActivate={setEvidence} />
        {insight.segment === 'label' ? (
          <p className="text-muted text-xs">
            Issues can carry several labels, so label segments may overlap.
          </p>
        ) : null}
      </AnalyticsCard>

      {evidence === null ? null : (
        <AnalyticsDrilldownDialog
          cohort={evidence}
          onOpenChange={(open) => {
            if (!open) setEvidence(null);
          }}
          open
          query={query}
          title={label}
        />
      )}
    </div>
  );
}
