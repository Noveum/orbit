'use client';

import { CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/cn.ts';

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calendarDateOf(value: string | null): string {
  if (value === null) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function dueDateLabel(value: string | null): string {
  const day = calendarDateOf(value);
  if (day === '') return 'No due date';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export interface DueDateFieldProps {
  readonly value: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (value: string | null) => void;
  readonly triggerClassName: string;
}

export function DueDateField({
  value,
  open,
  onOpenChange,
  onChange,
  triggerClassName,
}: DueDateFieldProps) {
  const current = calendarDateOf(value);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName} data-testid="property-due-date">
          <CalendarDays className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <span className={cn(current === '' ? 'text-muted' : 'text-text')}>
            {dueDateLabel(value)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 p-2">
        <label className="flex flex-col gap-1 text-2xs text-faint" htmlFor="issue-due-date">
          Due date
          <Input
            id="issue-due-date"
            type="date"
            value={current}
            data-testid="due-date-input"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next === '') {
                onChange(null);
                return;
              }
              if (isCalendarDate(next)) onChange(next);
            }}
          />
        </label>
        <Button
          size="sm"
          variant="ghost"
          data-testid="due-date-clear"
          disabled={current === ''}
          onClick={() => {
            onChange(null);
            onOpenChange(false);
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear
        </Button>
      </PopoverContent>
    </Popover>
  );
}
