'use client';

import { FILTER_PROPERTIES, type FilterCondition, type FilterGroup } from '@orbit/shared/filters';
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
import { buildFilterFields, describeCondition } from '@/features/filters/filter-fields.tsx';
import { FilterMenu } from '@/features/filters/filter-menu.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { DateRangePicker } from './date-range-picker.tsx';

interface ConditionEntry {
  readonly condition: FilterCondition;
  readonly path: readonly number[];
  readonly context: string;
}

function conditionEntries(
  group: FilterGroup,
  path: readonly number[] = [],
  parents: readonly string[] = [],
): ConditionEntry[] {
  const context = [...parents, group.combinator === 'and' ? 'All' : 'Any'];
  return group.children.flatMap((child, index) => {
    const childPath = [...path, index];
    return child.kind === 'condition'
      ? [{ condition: child, path: childPath, context: context.join(' › ') }]
      : conditionEntries(child, childPath, context);
  });
}

function removeAtPath(group: FilterGroup, path: readonly number[]): FilterGroup {
  const [index, ...rest] = path;
  if (index === undefined) return group;
  const child = group.children[index];
  if (child === undefined) return group;
  const children = [...group.children];
  if (rest.length === 0) children.splice(index, 1);
  else if (child.kind === 'group') {
    const next = removeAtPath(child, rest);
    if (next.children.length === 0) children.splice(index, 1);
    else children[index] = next;
  }
  return { ...group, children };
}

function replaceAtPath(
  group: FilterGroup,
  path: readonly number[],
  condition: FilterCondition,
): FilterGroup {
  const [index, ...rest] = path;
  if (index === undefined) return group;
  const child = group.children[index];
  if (child === undefined) return group;
  const children = [...group.children];
  if (rest.length === 0) children[index] = condition;
  else if (child.kind === 'group') children[index] = replaceAtPath(child, rest, condition);
  return { ...group, children };
}

function conditionFrom(group: FilterGroup): FilterCondition | null {
  const child = group.children[0];
  return child?.kind === 'condition' ? child : null;
}

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
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const conditions = conditionEntries(query.filter);
  const fields = useMemo(
    () => buildFilterFields(workspace, null, FILTER_PROPERTIES, { workspaceWide: true }),
    [workspace],
  );
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
      {conditions.map((entry) => {
        const pathKey = entry.path.join('.');
        const description = describeCondition(entry.condition, fields);
        const isolated: FilterGroup = {
          kind: 'group',
          combinator: 'and',
          children: [entry.condition],
        };
        return (
          <span
            className="flex h-7 items-center rounded-md border border-border bg-surface-2 text-xs"
            key={pathKey}
          >
            <span className="border-border border-r px-1.5 text-faint">{entry.context}</span>
            <FilterMenu
              anchor={
                <button
                  aria-label={`Edit filter: ${description}`}
                  className="h-full px-2 text-text hover:bg-surface-3"
                  onClick={() => setEditingPath(pathKey)}
                  type="button"
                >
                  {description}
                </button>
              }
              facets={undefined}
              fields={fields}
              filter={isolated}
              onChange={(next) => {
                const condition = conditionFrom(next);
                onChange({
                  filter:
                    condition === null
                      ? removeAtPath(query.filter, entry.path)
                      : replaceAtPath(query.filter, entry.path, condition),
                });
              }}
              onOpenChange={(open) => setEditingPath(open ? pathKey : null)}
              open={editingPath === pathKey}
              startProperty={entry.condition.property}
            />
            <button
              aria-label={`Remove filter: ${description}`}
              className="flex h-full items-center border-border border-l px-1.5 text-faint hover:text-text"
              onClick={() => onChange({ filter: removeAtPath(query.filter, entry.path) })}
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
