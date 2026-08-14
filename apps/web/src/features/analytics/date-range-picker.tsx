'use client';

import type { AnalyticsRange } from '@orbit/shared/validators';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';

const RANGE_LABELS: Record<Exclude<AnalyticsRange['preset'], 'custom'>, string> = {
  auto: 'Active sprint or last 30 days',
  active_sprint: 'Active sprint',
  previous_sprint: 'Previous sprint',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  all_time: 'All time',
};

const PRESETS: Array<{
  readonly preset: Exclude<AnalyticsRange['preset'], 'custom'>;
  readonly label: string;
}> = [
  { preset: 'auto', label: 'Automatic' },
  { preset: 'active_sprint', label: 'Active sprint' },
  { preset: 'previous_sprint', label: 'Previous sprint' },
  { preset: 'last_30_days', label: 'Last 30 days' },
  { preset: 'last_90_days', label: 'Last 90 days' },
  { preset: 'all_time', label: 'All time' },
];

export function rangeLabel(range: AnalyticsRange): string {
  if (range.preset !== 'custom') return RANGE_LABELS[range.preset];
  return `${range.from} to ${range.to}`;
}

export function DateRangePicker({
  value,
  onChange,
}: {
  readonly value: AnalyticsRange;
  readonly onChange: (range: AnalyticsRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value.preset === 'custom');
  const [from, setFrom] = useState(value.preset === 'custom' ? value.from : '');
  const [to, setTo] = useState(value.preset === 'custom' ? value.to : '');
  const [error, setError] = useState<string | null>(null);

  const applyCustom = () => {
    if (from.length === 0 || to.length === 0) {
      setError('Choose both a start date and an end date.');
      return;
    }
    if (from > to) {
      setError('End date must be on or after start date.');
      return;
    }
    onChange({ preset: 'custom', from, to });
    setError(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={`Reporting range: ${rangeLabel(value)}`} size="sm">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {rangeLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="grid gap-1">
          {PRESETS.map((option) => (
            <Button
              block
              className="justify-start"
              key={option.preset}
              onClick={() => {
                onChange({ preset: option.preset });
                setError(null);
                setOpen(false);
              }}
              size="sm"
              variant="ghost"
            >
              {option.label}
            </Button>
          ))}
          <Button
            block
            className="justify-start"
            onClick={() => setCustom(true)}
            size="sm"
            variant="ghost"
          >
            Custom range
          </Button>
        </div>
        {custom ? (
          <div className="mt-2 grid gap-2 border-border border-t pt-3">
            <label className="grid gap-1 text-muted text-xs">
              Start date
              <input
                className="h-8 rounded-md border border-border bg-surface px-2 text-text outline-none focus:border-border-strong"
                onChange={(event) => setFrom(event.currentTarget.value)}
                type="date"
                value={from}
              />
            </label>
            <label className="grid gap-1 text-muted text-xs">
              End date
              <input
                className="h-8 rounded-md border border-border bg-surface px-2 text-text outline-none focus:border-border-strong"
                onChange={(event) => setTo(event.currentTarget.value)}
                type="date"
                value={to}
              />
            </label>
            {error === null ? null : (
              <p className="text-danger text-xs" role="alert">
                {error}
              </p>
            )}
            <Button block onClick={applyCustom} size="sm" variant="primary">
              Apply range
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
