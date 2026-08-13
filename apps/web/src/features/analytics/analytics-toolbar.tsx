'use client';

import {
  conditionsOf,
  FILTER_PROPERTIES,
  FILTER_PROPERTY_LABELS,
  removeCondition,
} from '@orbit/shared/filters';
import type { AnalyticsCompare, AnalyticsMeasure, AnalyticsQuery } from '@orbit/shared/validators';
import { ListFilter, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { buildFilterFields } from '@/features/filters/filter-fields.tsx';
import { FilterMenu } from '@/features/filters/filter-menu.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { DateRangePicker } from './date-range-picker.tsx';

export function AnalyticsToolbar({
  query,
  onChange,
  onReset,
}: {
  readonly query: AnalyticsQuery;
  readonly onChange: (patch: Partial<AnalyticsQuery>) => void;
  readonly onReset: () => void;
}) {
  const workspace = useWorkspace();
  const [filterOpen, setFilterOpen] = useState(false);
  const conditions = conditionsOf(query.filter);
  const fields = useMemo(() => buildFilterFields(workspace, null, FILTER_PROPERTIES), [workspace]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker value={query.range} onChange={(range) => onChange({ range })} />
      <Select
        onValueChange={(value) => onChange({ compare: value as AnalyticsCompare })}
        value={query.compare}
      >
        <SelectTrigger aria-label="Comparison" className="h-7 w-auto min-w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Automatic comparison</SelectItem>
          <SelectItem value="previous_period">Previous period</SelectItem>
          <SelectItem value="previous_sprint">Previous sprint</SelectItem>
          <SelectItem value="none">No comparison</SelectItem>
        </SelectContent>
      </Select>
      <Select
        onValueChange={(value) => onChange({ measure: value as AnalyticsMeasure })}
        value={query.measure}
      >
        <SelectTrigger aria-label="Measure" className="h-7 w-auto min-w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="issues">Issues</SelectItem>
          <SelectItem value="points">Points</SelectItem>
        </SelectContent>
      </Select>
      {conditions.map((condition) => {
        const label = FILTER_PROPERTY_LABELS[condition.property];
        return (
          <span
            className="flex h-7 items-center rounded-md border border-border bg-surface-2 text-xs"
            key={JSON.stringify(condition)}
          >
            <span className="px-2 text-text">{label}</span>
            <button
              aria-label={`Remove ${label} filter`}
              className="flex h-full items-center border-border border-l px-1.5 text-faint hover:text-text"
              onClick={() =>
                onChange({ filter: removeCondition(query.filter, condition.property) })
              }
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        );
      })}
      <FilterMenu
        anchor={
          <Button
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen(!filterOpen)}
            size="sm"
            variant="ghost"
          >
            <ListFilter aria-hidden="true" className="size-3.5" />
            Add filter
          </Button>
        }
        facets={undefined}
        fields={fields}
        filter={query.filter}
        onChange={(filter) => onChange({ filter })}
        onOpenChange={setFilterOpen}
        open={filterOpen}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            Scope
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <p className="font-medium text-text text-xs">Additional scope</p>
          <label className="mt-3 flex items-center justify-between gap-3 text-muted text-xs">
            Include archived work
            <input
              checked={query.includeArchived}
              onChange={(event) => onChange({ includeArchived: event.currentTarget.checked })}
              type="checkbox"
            />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 text-muted text-xs">
            Include canceled work
            <input
              checked={query.includeCanceled}
              onChange={(event) => onChange({ includeCanceled: event.currentTarget.checked })}
              type="checkbox"
            />
          </label>
        </PopoverContent>
      </Popover>
      <Button
        aria-label="Reset analytics"
        className="ml-auto"
        onClick={onReset}
        size="sm"
        variant="ghost"
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        Reset
      </Button>
    </div>
  );
}
