'use client';

import { FILTER_PROPERTIES, type FilterCondition, type FilterGroup } from '@orbit/shared/filters';
import { sprintLabel } from '@orbit/shared/utils';
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
import {
  buildFilterFields,
  describeCondition,
  type FilterFieldDefinition,
} from '@/features/filters/filter-fields.tsx';
import { FilterMenu } from '@/features/filters/filter-menu.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { Cycle } from '@/lib/query/schemas.ts';
import { DateRangePicker } from './date-range-picker.tsx';

const AUTOMATIC_SPRINT = 'automatic';

function isDirectSprintSelector(
  child: FilterGroup['children'][number],
): child is FilterCondition & { readonly operator: 'in' } {
  return (
    child.kind === 'condition' &&
    child.property === 'cycle' &&
    child.operator === 'in' &&
    !child.negate &&
    child.values.length === 1
  );
}

export function selectedSprintId(filter: FilterGroup): string | null {
  if (filter.combinator !== 'and') return null;
  const selector = filter.children.find(isDirectSprintSelector);
  return selector?.values[0] ?? null;
}

export function withSelectedSprint(filter: FilterGroup, sprintId: string | null): FilterGroup {
  const withoutSelector =
    filter.combinator === 'and'
      ? { ...filter, children: filter.children.filter((child) => !isDirectSprintSelector(child)) }
      : filter;
  const base =
    withoutSelector.combinator === 'and' &&
    withoutSelector.children.length === 1 &&
    withoutSelector.children[0]?.kind === 'group'
      ? withoutSelector.children[0]
      : withoutSelector;
  if (sprintId === null) return base;
  const selector: FilterCondition = {
    kind: 'condition',
    property: 'cycle',
    operator: 'in',
    values: [sprintId],
    negate: false,
  };
  return base.combinator === 'and'
    ? { ...base, children: [...base.children, selector] }
    : { kind: 'group', combinator: 'and', children: [base, selector] };
}

export function SprintFilterSelect({
  cycles,
  filter,
  onChange,
}: {
  readonly cycles: readonly Cycle[];
  readonly filter: FilterGroup;
  readonly onChange: (filter: FilterGroup) => void;
}) {
  const ordered = useMemo(
    () => [...cycles].sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
    [cycles],
  );
  return (
    <Select
      onValueChange={(value) =>
        onChange(withSelectedSprint(filter, value === AUTOMATIC_SPRINT ? null : value))
      }
      value={selectedSprintId(filter) ?? AUTOMATIC_SPRINT}
    >
      <SelectTrigger aria-label="Sprint" className="h-7 w-auto min-w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTOMATIC_SPRINT}>Automatic sprint</SelectItem>
        {ordered.map((cycle) => (
          <SelectItem key={cycle.id} value={cycle.id}>
            {sprintLabel(cycle)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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

interface FilterExpressionProps {
  readonly group: FilterGroup;
  readonly root: FilterGroup;
  readonly path: readonly number[];
  readonly fields: readonly FilterFieldDefinition[];
  readonly editingPath: string | null;
  readonly setEditingPath: (path: string | null) => void;
  readonly onChange: (filter: FilterGroup) => void;
}

function ConditionChip({
  condition,
  path,
  root,
  fields,
  editingPath,
  setEditingPath,
  onChange,
}: Omit<FilterExpressionProps, 'group'> & { readonly condition: FilterCondition }) {
  const pathKey = path.join('.');
  const description = describeCondition(condition, fields);
  const isolated: FilterGroup = {
    kind: 'group',
    combinator: 'and',
    children: [condition],
  };
  return (
    <span className="flex h-7 items-center rounded-md border border-border bg-surface-2 text-xs">
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
          const nextCondition = conditionFrom(next);
          onChange(
            nextCondition === null
              ? removeAtPath(root, path)
              : replaceAtPath(root, path, nextCondition),
          );
        }}
        onOpenChange={(open) => setEditingPath(open ? pathKey : null)}
        open={editingPath === pathKey}
        startProperty={condition.property}
      />
      <button
        aria-label={`Remove filter: ${description}`}
        className="flex h-full items-center border-border border-l px-1.5 text-faint hover:text-text"
        onClick={() => onChange(removeAtPath(root, path))}
        type="button"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

function FilterExpression(props: FilterExpressionProps) {
  const { group, path } = props;
  const pathKey = path.length === 0 ? 'root' : path.join('.');
  const conjunction = group.combinator === 'and' ? 'and' : 'or';
  return (
    <fieldset
      className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-background px-1 py-1"
      data-testid={`filter-group-${pathKey}`}
    >
      <legend className="float-left px-1 text-faint text-2xs uppercase">
        Match {group.combinator === 'and' ? 'all' : 'any'} filter group
      </legend>
      {group.children.map((child, index) => {
        const childPath = [...path, index];
        return (
          <span className="inline-flex items-center gap-1" key={childPath.join('.')}>
            {index === 0 ? null : <span className="px-0.5 text-faint text-2xs">{conjunction}</span>}
            {child.kind === 'condition' ? (
              <ConditionChip {...props} condition={child} path={childPath} />
            ) : (
              <FilterExpression {...props} group={child} path={childPath} />
            )}
          </span>
        );
      })}
    </fieldset>
  );
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
  const fields = useMemo(
    () => buildFilterFields(workspace, null, FILTER_PROPERTIES, { workspaceWide: true }),
    [workspace],
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {query.lens === 'sprints' && workspace.cycles.length > 0 ? (
        <SprintFilterSelect
          cycles={workspace.cycles}
          filter={query.filter}
          onChange={(filter) => onChange({ filter })}
        />
      ) : null}
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
      {query.filter.children.length === 0 ? null : (
        <FilterExpression
          editingPath={editingPath}
          fields={fields}
          group={query.filter}
          onChange={(filter) => onChange({ filter })}
          path={[]}
          root={query.filter}
          setEditingPath={setEditingPath}
        />
      )}
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
