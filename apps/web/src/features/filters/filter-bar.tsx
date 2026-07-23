'use client';

import type { FilterField, FilterPredicate } from '@orbit/shared/filters';
import { dropLastPredicate, removePredicate } from '@orbit/shared/filters';
import { Bookmark, ListFilter, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { DisplayMenu } from './display-menu.tsx';
import type { FilterFieldDefinition } from './filter-fields.tsx';
import { buildFilterFields, operatorLabel, valueLabel } from './filter-fields.tsx';
import { FilterMenu } from './filter-menu.tsx';
import { SaveViewDialog } from './save-view-dialog.tsx';
import type { ViewConfig, ViewLayoutMode } from './view-config.ts';

type MenuTarget = FilterField | 'new' | null;

export interface FilterBarProps {
  readonly teamId: string | null;
  readonly teamName: string;
  readonly layout: ViewLayoutMode;
  readonly config: ViewConfig;
  readonly onChange: (next: ViewConfig) => void;
}

export function FilterBar({ teamId, teamName, layout, config, onChange }: FilterBarProps) {
  const workspace = useWorkspace();
  const [target, setTarget] = useState<MenuTarget>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const fields = useMemo(() => buildFilterFields(workspace, teamId), [workspace, teamId]);
  const { predicates } = config;

  const setPredicates = (next: readonly FilterPredicate[]) => {
    onChange({ ...config, predicates: next });
  };

  useHotkey('f', () => setTarget('new'), {
    label: 'Add filter',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('shift+f', () => setPredicates(dropLastPredicate(predicates)), {
    label: 'Remove the last filter',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('alt+shift+f', () => setPredicates([]), {
    label: 'Clear all filters',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('alt+v', () => setSaveOpen(true), {
    label: 'Save as a view',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('escape', () => setTarget(null), {
    label: 'Close the filter menu',
    section: 'View',
    scope: 'filters',
    priority: HOTKEY_PRIORITY.layer,
    enabled: target !== null,
    preventDefault: false,
  });

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-border border-b px-3 py-1.5"
      data-testid="filter-bar"
    >
      {predicates.map((predicate) => (
        <FilterChip
          key={predicate.field}
          predicate={predicate}
          definition={fields.find((entry) => entry.field === predicate.field)}
          open={target === predicate.field}
          onOpenChange={(open) => setTarget(open ? predicate.field : null)}
          fields={fields}
          predicates={predicates}
          onChange={setPredicates}
          onRemove={() => setPredicates(removePredicate(predicates, predicate.field))}
        />
      ))}

      <FilterMenu
        open={target === 'new'}
        onOpenChange={(open) => setTarget(open ? 'new' : null)}
        fields={fields}
        predicates={predicates}
        onChange={setPredicates}
        anchor={
          <Button
            size="sm"
            variant="ghost"
            data-testid="add-filter"
            aria-haspopup="listbox"
            aria-expanded={target === 'new'}
            onClick={() => setTarget(target === 'new' ? null : 'new')}
          >
            <ListFilter className="size-3.5" aria-hidden="true" />
            {predicates.length === 0 ? 'Filter' : 'Add filter'}
          </Button>
        }
      />

      <div className="ml-auto flex items-center gap-1">
        {predicates.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            data-testid="clear-filters"
            onClick={() => setPredicates([])}
          >
            Clear
          </Button>
        )}
        <Button size="sm" variant="ghost" data-testid="save-view" onClick={() => setSaveOpen(true)}>
          <Bookmark className="size-3.5" aria-hidden="true" />
          Save view
        </Button>
        <DisplayMenu config={config} onChange={onChange} />
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        config={config}
        layout={layout}
        teamId={teamId}
        suggestedName={suggestName(teamName, predicates, fields)}
      />
    </div>
  );
}

function suggestName(
  teamName: string,
  predicates: readonly FilterPredicate[],
  fields: readonly FilterFieldDefinition[],
): string {
  const first = predicates[0];
  if (first === undefined) return `${teamName} issues`;
  const definition = fields.find((entry) => entry.field === first.field);
  return `${teamName}: ${valueLabel(first, definition)}`;
}

interface FilterChipProps {
  readonly predicate: FilterPredicate;
  readonly definition: FilterFieldDefinition | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fields: readonly FilterFieldDefinition[];
  readonly predicates: readonly FilterPredicate[];
  readonly onChange: (next: readonly FilterPredicate[]) => void;
  readonly onRemove: () => void;
}

function FilterChip({
  predicate,
  definition,
  open,
  onOpenChange,
  fields,
  predicates,
  onChange,
  onRemove,
}: FilterChipProps) {
  const Icon = definition?.icon;
  const label = definition?.label ?? predicate.field;
  const description = `${label} ${operatorLabel(predicate)} ${valueLabel(predicate, definition)}`;

  return (
    <span
      className="flex h-7 items-center rounded-md border border-border bg-surface-2 text-2xs"
      data-testid={`filter-chip-${predicate.field}`}
    >
      <FilterMenu
        open={open}
        onOpenChange={onOpenChange}
        fields={fields}
        predicates={predicates}
        onChange={onChange}
        startField={predicate.field}
        anchor={
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Edit filter: ${description}`}
            onClick={() => onOpenChange(!open)}
            className="flex h-7 items-center gap-1.5 rounded-l-md px-2 text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
          >
            {Icon === undefined ? null : (
              <Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="text-faint">{label}</span>
            <span className="text-faint italic">{operatorLabel(predicate)}</span>
            <span className="max-w-40 truncate text-text">{valueLabel(predicate, definition)}</span>
          </button>
        }
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${description}`}
        data-testid={`remove-filter-${predicate.field}`}
        className="flex h-7 items-center rounded-r-md border-border border-l px-1.5 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-3 hover:text-text"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
