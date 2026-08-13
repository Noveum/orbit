'use client';

import type { AnalyticsCompare, AnalyticsMeasure, AnalyticsQuery } from '@orbit/shared/validators';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
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
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            Add filter
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
          <p className="mt-3 border-border border-t pt-3 text-faint text-xs">
            Open a lens to narrow by its projects, milestones, sprints, or people. Advanced issue
            filters stay encoded in shared URLs.
          </p>
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
