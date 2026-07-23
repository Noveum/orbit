'use client';

import type { FilterCondition, FilterGroup, FilterProperty } from '@orbit/shared/filters';
import { conditionsOf, dropLastCondition, removeCondition } from '@orbit/shared/filters';
import { Bookmark, ListFilter, Save, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import type { Issue, View } from '@/lib/query/schemas.ts';
import { useUpdateView } from '@/lib/query/use-views.ts';
import { DisplayMenu } from './display-menu.tsx';
import type { FilterFieldDefinition } from './filter-fields.tsx';
import { buildFilterFields, operatorLabel, valueLabel } from './filter-fields.tsx';
import { FilterMenu } from './filter-menu.tsx';
import { SaveViewDialog } from './save-view-dialog.tsx';
import type { ViewConfig, ViewLayoutMode } from './view-config.ts';
import { viewConfigToState } from './view-config.ts';
import type { ViewControls } from './view-controls.tsx';

type MenuTarget = FilterProperty | 'new' | null;

export interface FilterBarProps {
  readonly teamId: string | null;
  readonly teamName: string;
  readonly layout: ViewLayoutMode;
  readonly config: ViewConfig;
  readonly onChange: (next: ViewConfig) => void;
  readonly controls: ViewControls;
  readonly issues?: readonly Issue[];
  readonly savedView?: View | null;
  readonly dirty?: boolean;
}

export function FilterBar({
  teamId,
  teamName,
  layout,
  config,
  onChange,
  controls,
  issues = [],
  savedView = null,
  dirty = false,
}: FilterBarProps) {
  const workspace = useWorkspace();
  const updateView = useUpdateView();
  const [target, setTarget] = useState<MenuTarget>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const fields = useMemo(
    () => buildFilterFields(workspace, teamId, controls.capability.filters),
    [workspace, teamId, controls.capability.filters],
  );
  const conditions = conditionsOf(config.filter);

  const setFilter = (next: FilterGroup) => {
    onChange({ ...config, filter: next });
  };

  const canUpdate =
    savedView !== null &&
    !savedView.virtual &&
    !savedView.locked &&
    savedView.ownerId === workspace.userId &&
    dirty;

  useHotkey('f', () => setTarget('new'), {
    label: 'Add filter',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('shift+f', () => setFilter(dropLastCondition(config.filter)), {
    label: 'Remove the last filter',
    section: 'View',
    scope: 'filters',
  });
  useHotkey('alt+shift+f', () => setFilter({ ...config.filter, children: [] }), {
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
      {conditions.map((condition) => (
        <FilterChip
          key={condition.property}
          condition={condition}
          definition={fields.find((entry) => entry.property === condition.property)}
          open={target === condition.property}
          onOpenChange={(open) => setTarget(open ? condition.property : null)}
          fields={fields}
          filter={config.filter}
          issues={issues}
          onChange={setFilter}
          onRemove={() => setFilter(removeCondition(config.filter, condition.property))}
        />
      ))}

      <FilterMenu
        open={target === 'new'}
        onOpenChange={(open) => setTarget(open ? 'new' : null)}
        fields={fields}
        filter={config.filter}
        issues={issues}
        onChange={setFilter}
        anchor={
          <Button
            size="sm"
            variant="ghost"
            data-testid="add-filter"
            aria-haspopup="dialog"
            aria-expanded={target === 'new'}
            onClick={() => setTarget(target === 'new' ? null : 'new')}
          >
            <ListFilter className="size-3.5" aria-hidden="true" />
            {conditions.length === 0 ? 'Filter' : 'Add filter'}
          </Button>
        }
      />

      <div className="ml-auto flex items-center gap-1">
        {conditions.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            data-testid="clear-filters"
            onClick={() => setFilter({ ...config.filter, children: [] })}
          >
            Clear
          </Button>
        )}
        {canUpdate && savedView !== null ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="update-view"
            disabled={updateView.isPending}
            onClick={() =>
              updateView.mutate({
                id: savedView.id,
                patch: {
                  filter: viewConfigToState(
                    config,
                    layout,
                    { teamId, projectId: null },
                    {
                      visibility: savedView.filter.visibility,
                      locked: savedView.filter.locked,
                      position: savedView.filter.position,
                    },
                  ),
                },
              })
            }
          >
            <Save className="size-3.5" aria-hidden="true" />
            Save changes
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" data-testid="save-view" onClick={() => setSaveOpen(true)}>
          <Bookmark className="size-3.5" aria-hidden="true" />
          Save view
        </Button>
        <DisplayMenu
          config={config}
          capability={controls.capability}
          modified={controls.displayModified}
          onChange={onChange}
        />
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        config={config}
        layout={layout}
        teamId={teamId}
        suggestedName={suggestName(teamName, conditions, fields)}
      />
    </div>
  );
}

function suggestName(
  teamName: string,
  conditions: readonly FilterCondition[],
  fields: readonly FilterFieldDefinition[],
): string {
  const first = conditions[0];
  if (first === undefined) return `${teamName} issues`;
  const definition = fields.find((entry) => entry.property === first.property);
  return `${teamName}: ${valueLabel(first, definition)}`;
}

interface FilterChipProps {
  readonly condition: FilterCondition;
  readonly definition: FilterFieldDefinition | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fields: readonly FilterFieldDefinition[];
  readonly filter: FilterGroup;
  readonly issues: readonly Issue[];
  readonly onChange: (next: FilterGroup) => void;
  readonly onRemove: () => void;
}

function FilterChip({
  condition,
  definition,
  open,
  onOpenChange,
  fields,
  filter,
  issues,
  onChange,
  onRemove,
}: FilterChipProps) {
  const Icon = definition?.icon;
  const label = definition?.label ?? condition.property;
  const description = `${label} ${operatorLabel(condition)} ${valueLabel(condition, definition)}`;

  return (
    <span
      className="flex h-7 items-center rounded-md border border-border bg-surface-2 text-2xs"
      data-testid={`filter-chip-${condition.property}`}
    >
      <FilterMenu
        open={open}
        onOpenChange={onOpenChange}
        fields={fields}
        filter={filter}
        issues={issues}
        onChange={onChange}
        startProperty={condition.property}
        anchor={
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`Edit filter: ${description}`}
            onClick={() => onOpenChange(!open)}
            className="flex h-7 items-center gap-1.5 rounded-l-md px-2 text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
          >
            {Icon === undefined ? null : (
              <Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="text-faint">{label}</span>
            <span className="text-faint italic">{operatorLabel(condition)}</span>
            <span className="max-w-40 truncate text-text">{valueLabel(condition, definition)}</span>
          </button>
        }
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${description}`}
        data-testid={`remove-filter-${condition.property}`}
        className="flex h-7 items-center rounded-r-md border-border border-l px-1.5 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-3 hover:text-text"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
