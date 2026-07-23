'use client';

import type { FilterField, FilterPredicate } from '@orbit/shared/filters';
import { removePredicate, replacePredicate } from '@orbit/shared/filters';
import { Command } from 'cmdk';
import { Check, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/cn.ts';
import type { FilterFieldDefinition } from './filter-fields.tsx';

const itemClassName =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-dense text-muted outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] data-[selected=true]:bg-surface-2 data-[selected=true]:text-text data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

const groupClassName =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase';

export interface FilterMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fields: readonly FilterFieldDefinition[];
  readonly predicates: readonly FilterPredicate[];
  readonly onChange: (next: readonly FilterPredicate[]) => void;
  readonly startField?: FilterField | null;
  readonly anchor: ReactNode;
}

function predicateFor(
  predicates: readonly FilterPredicate[],
  field: FilterField,
): FilterPredicate | undefined {
  return predicates.find((predicate) => predicate.field === field);
}

export function FilterMenu({
  open,
  onOpenChange,
  fields,
  predicates,
  onChange,
  startField = null,
  anchor,
}: FilterMenuProps) {
  const [field, setField] = useState<FilterField | null>(startField);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setField(startField);
      setSearch('');
    }
  }, [open, startField]);

  const active = fields.find((entry) => entry.field === field);

  const toggleValue = (target: FilterField, value: string) => {
    const current = predicateFor(predicates, target);
    const operator = current?.operator ?? 'is';
    const values = current?.values ?? [];
    const next = values.includes(value)
      ? values.filter((entry) => entry !== value)
      : [...values, value];
    onChange(
      next.length === 0
        ? removePredicate(predicates, target)
        : replacePredicate(predicates, { field: target, operator, values: next }),
    );
  };

  const toggleOperator = (target: FilterField) => {
    const current = predicateFor(predicates, target);
    if (current === undefined) return;
    onChange(
      replacePredicate(predicates, {
        ...current,
        operator: current.operator === 'is' ? 'is_not' : 'is',
      }),
    );
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
          key={field ?? 'fields'}
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
              placeholder={active === undefined ? 'Filter by...' : `Search ${active.label}...`}
              className="h-9 w-full bg-transparent text-dense text-text outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1.5">
            <Command.Empty className="px-2 py-5 text-center text-2xs text-muted">
              Nothing matches that.
            </Command.Empty>

            {active === undefined ? (
              <FieldPicker
                fields={fields}
                predicates={predicates}
                searching={search.trim().length > 0}
                onPickField={(next) => {
                  setSearch('');
                  setField(next);
                }}
                onPickValue={toggleValue}
              />
            ) : (
              <ValuePicker
                definition={active}
                predicate={predicateFor(predicates, active.field)}
                onToggleValue={(value) => toggleValue(active.field, value)}
                onToggleOperator={() => toggleOperator(active.field)}
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
  readonly predicates: readonly FilterPredicate[];
  readonly searching: boolean;
  readonly onPickField: (field: FilterField) => void;
  readonly onPickValue: (field: FilterField, value: string) => void;
}

function FieldPicker({
  fields,
  predicates,
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
              key={definition.field}
              value={`field ${definition.field} ${definition.label}`}
              data-testid={`filter-field-${definition.field}`}
              className={itemClassName}
              onSelect={() => onPickField(definition.field)}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1 truncate">{definition.label}</span>
            </Command.Item>
          );
        })}
      </Command.Group>

      {searching
        ? fields.map((definition) => (
            <Command.Group
              key={definition.field}
              heading={definition.label}
              className={groupClassName}
            >
              {definition.options.map((option) => (
                <Command.Item
                  key={`${definition.field}-${option.value}`}
                  value={`value ${definition.label} ${option.label} ${option.value}`}
                  className={itemClassName}
                  onSelect={() => onPickValue(definition.field, option.value)}
                >
                  {option.icon}
                  <span className="flex-1 truncate">{option.label}</span>
                  <Selected
                    on={
                      predicates
                        .find((predicate) => predicate.field === definition.field)
                        ?.values.includes(option.value) ?? false
                    }
                  />
                </Command.Item>
              ))}
            </Command.Group>
          ))
        : null}
    </>
  );
}

interface ValuePickerProps {
  readonly definition: FilterFieldDefinition;
  readonly predicate: FilterPredicate | undefined;
  readonly onToggleValue: (value: string) => void;
  readonly onToggleOperator: () => void;
}

function ValuePicker({ definition, predicate, onToggleValue, onToggleOperator }: ValuePickerProps) {
  const negated = predicate?.operator === 'is_not';
  return (
    <>
      {predicate === undefined ? null : (
        <Command.Group heading="Operator" className={groupClassName}>
          <Command.Item
            value={`operator ${definition.label}`}
            data-testid="filter-toggle-operator"
            className={itemClassName}
            onSelect={onToggleOperator}
          >
            <span className="flex-1 truncate">{negated ? 'Include instead' : 'Exclude these'}</span>
            <span className="text-2xs text-faint">{negated ? 'is not' : 'is'}</span>
          </Command.Item>
        </Command.Group>
      )}
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
            <Selected on={predicate?.values.includes(option.value) ?? false} />
          </Command.Item>
        ))}
      </Command.Group>
    </>
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
