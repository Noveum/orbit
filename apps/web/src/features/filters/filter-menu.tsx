'use client';

import type { FilterCondition, FilterGroup, FilterProperty } from '@orbit/shared/filters';
import { conditionFor, removeCondition, replaceCondition } from '@orbit/shared/filters';
import { Command } from 'cmdk';
import { Check, ChevronRight, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import type { FilterFieldDefinition } from './filter-fields.tsx';
import { countValues, RELATIVE_PRESETS } from './filter-fields.tsx';

const itemClassName =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-dense text-muted outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-text';

const groupClassName =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase';

export interface FilterMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fields: readonly FilterFieldDefinition[];
  readonly filter: FilterGroup;
  readonly onChange: (next: FilterGroup) => void;
  readonly issues: readonly Issue[];
  readonly startProperty?: FilterProperty | null;
  readonly anchor: ReactNode;
}

export function FilterMenu({
  open,
  onOpenChange,
  fields,
  filter,
  onChange,
  issues,
  startProperty = null,
  anchor,
}: FilterMenuProps) {
  const [property, setProperty] = useState<FilterProperty | null>(startProperty);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setProperty(startProperty);
      setSearch('');
    }
  }, [open, startProperty]);

  const active = fields.find((entry) => entry.property === property);

  const commit = (next: FilterCondition | null, target: FilterProperty) => {
    onChange(next === null ? removeCondition(filter, target) : replaceCondition(filter, next));
  };

  const toggleValue = (target: FilterProperty, value: string) => {
    const current = conditionFor(filter, target);
    const values = current?.operator === 'in' ? current.values : [];
    const negate = current?.negate ?? false;
    const next = values.includes(value)
      ? values.filter((entry) => entry !== value)
      : [...values, value];
    commit(
      next.length === 0
        ? null
        : { kind: 'condition', property: target, operator: 'in', values: next, negate },
      target,
    );
  };

  const toggleNegate = (target: FilterProperty) => {
    const current = conditionFor(filter, target);
    if (current === undefined) return;
    commit({ ...current, negate: !current.negate }, target);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        collisionPadding={12}
        className="w-72 p-0"
        data-testid="filter-menu"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command
          key={property ?? 'fields'}
          loop
          label={active === undefined ? 'Add filter' : `Filter by ${active.label}`}
        >
          <div className="flex items-center gap-2 border-border border-b px-2.5">
            <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              data-testid="filter-menu-input"
              aria-label={active === undefined ? 'Search filters' : `Search ${active.label}`}
              placeholder={active === undefined ? 'Add filter...' : `Search ${active.label}...`}
              className="h-9 w-full bg-transparent text-dense text-text outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-2 py-5 text-center text-2xs text-muted">
              Nothing matches that.
            </Command.Empty>

            {active === undefined ? (
              <FieldPicker
                fields={fields}
                filter={filter}
                issues={issues}
                searching={search.trim().length > 0}
                onPickField={(next) => {
                  setSearch('');
                  setProperty(next);
                }}
                onPickValue={toggleValue}
              />
            ) : (
              <ValuePicker
                definition={active}
                condition={conditionFor(filter, active.property)}
                issues={issues}
                search={search}
                onToggleValue={(value) => toggleValue(active.property, value)}
                onToggleNegate={() => toggleNegate(active.property)}
                onCommit={(next) => commit(next, active.property)}
              />
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface FieldPickerProps {
  readonly fields: readonly FilterFieldDefinition[];
  readonly filter: FilterGroup;
  readonly issues: readonly Issue[];
  readonly searching: boolean;
  readonly onPickField: (property: FilterProperty) => void;
  readonly onPickValue: (property: FilterProperty, value: string) => void;
}

function FieldPicker({
  fields,
  filter,
  issues,
  searching,
  onPickField,
  onPickValue,
}: FieldPickerProps) {
  return (
    <>
      <Command.Group heading="Filter by" className={groupClassName}>
        {fields.map((definition) => {
          const Icon = definition.icon;
          return (
            <Command.Item
              key={definition.property}
              value={`field ${definition.property} ${definition.label}`}
              data-testid={`filter-field-${definition.property}`}
              className={itemClassName}
              onSelect={() => onPickField(definition.property)}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1 truncate">{definition.label}</span>
              <ChevronRight className="size-3 shrink-0 text-faint" aria-hidden="true" />
            </Command.Item>
          );
        })}
      </Command.Group>

      {searching
        ? fields.map((definition) => (
            <Command.Group
              key={definition.property}
              heading={definition.label}
              className={groupClassName}
            >
              {definition.options.map((option) => (
                <Command.Item
                  key={`${definition.property}-${option.value}`}
                  value={`value ${definition.label} ${option.label} ${option.value}`}
                  className={itemClassName}
                  onSelect={() => onPickValue(definition.property, option.value)}
                >
                  {option.icon}
                  <span className="flex-1 truncate">{option.label}</span>
                  <ValueCount count={countValues(definition, issues).get(option.value)} />
                  <Selected
                    on={selectedValues(filter, definition.property).includes(option.value)}
                  />
                </Command.Item>
              ))}
            </Command.Group>
          ))
        : null}
    </>
  );
}

function selectedValues(filter: FilterGroup, property: FilterProperty): readonly string[] {
  const condition = conditionFor(filter, property);
  return condition?.operator === 'in' ? condition.values : [];
}

interface ValuePickerProps {
  readonly definition: FilterFieldDefinition;
  readonly condition: FilterCondition | undefined;
  readonly issues: readonly Issue[];
  readonly search: string;
  readonly onToggleValue: (value: string) => void;
  readonly onToggleNegate: () => void;
  readonly onCommit: (next: FilterCondition | null) => void;
}

function ValuePicker({
  definition,
  condition,
  issues,
  search,
  onToggleValue,
  onToggleNegate,
  onCommit,
}: ValuePickerProps) {
  const negated = condition?.negate === true;
  const counts = countValues(definition, issues);
  const chosen = condition?.operator === 'in' ? condition.values : [];

  return (
    <>
      {condition === undefined ? null : (
        <Command.Group heading="Operator" className={groupClassName}>
          <Command.Item
            value={`operator ${definition.label}`}
            data-testid="filter-toggle-operator"
            className={itemClassName}
            onSelect={onToggleNegate}
          >
            <span className="flex-1 truncate">{negated ? 'Include instead' : 'Exclude these'}</span>
            <span className="text-2xs text-faint">{negated ? 'is not' : 'is'}</span>
          </Command.Item>
        </Command.Group>
      )}

      {definition.input === 'text' ? (
        <Command.Group heading={definition.label} className={groupClassName}>
          <Command.Item
            value={`content ${search}`}
            data-testid="filter-content-apply"
            className={itemClassName}
            disabled={search.trim().length === 0}
            onSelect={() =>
              onCommit(
                search.trim().length === 0
                  ? null
                  : {
                      kind: 'condition',
                      property: definition.property,
                      operator: 'exact',
                      value: search.trim(),
                      negate: negated,
                    },
              )
            }
          >
            <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span className="flex-1 truncate">
              {search.trim().length === 0 ? 'Type to filter by content' : `Contains "${search}"`}
            </span>
          </Command.Item>
        </Command.Group>
      ) : null}

      {definition.input === 'dates' ? (
        <Command.Group heading="Relative" className={groupClassName}>
          {RELATIVE_PRESETS.map((preset) => (
            <Command.Item
              key={preset.key}
              value={`relative ${preset.label}`}
              data-testid={`filter-relative-${preset.key}`}
              className={itemClassName}
              onSelect={() =>
                onCommit({
                  kind: 'condition',
                  property: definition.property,
                  operator: 'relative',
                  relative: {
                    unit: preset.unit,
                    offset: preset.offset,
                    direction: preset.direction,
                  },
                  negate: negated,
                })
              }
            >
              <span className="flex-1 truncate">{preset.label}</span>
              <Selected
                on={
                  condition?.operator === 'relative' &&
                  condition.relative.unit === preset.unit &&
                  condition.relative.offset === preset.offset &&
                  condition.relative.direction === preset.direction
                }
              />
            </Command.Item>
          ))}
        </Command.Group>
      ) : null}

      {definition.options.length === 0 ? null : (
        <Command.Group heading={definition.label} className={groupClassName}>
          {definition.options.map((option) => (
            <Command.Item
              key={option.value}
              value={`${option.label} ${option.value}`}
              data-testid={`filter-value-${option.value}`}
              className={itemClassName}
              onSelect={() => onToggleValue(option.value)}
            >
              {option.icon}
              <span className="flex-1 truncate">{option.label}</span>
              <ValueCount count={counts.get(option.value)} />
              <Selected on={chosen.includes(option.value)} />
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

function ValueCount({ count }: { count: number | undefined }) {
  if (count === undefined || count === 0) return null;
  return (
    <span data-numeric className="shrink-0 text-2xs text-faint">
      {count.toLocaleString()}
    </span>
  );
}

function Selected({ on }: { on: boolean }) {
  return (
    <Check
      className={cn('size-3.5 shrink-0 text-accent', on ? 'opacity-100' : 'opacity-0')}
      aria-hidden="true"
    />
  );
}
