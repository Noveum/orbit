'use client';

import type {
  CompletedWindow,
  DisplayProperty,
  GroupByField,
  IssueOrdering,
  ViewCapability,
} from '@orbit/shared/filters';
import {
  COMPLETED_WINDOW_LABELS,
  COMPLETED_WINDOWS,
  DISPLAY_PROPERTIES,
  DISPLAY_PROPERTY_LABELS,
  GROUP_BY_LABELS,
  ISSUE_ORDERING_LABELS,
} from '@orbit/shared/filters';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import type { ViewConfig } from './view-config.ts';

export interface DisplayMenuProps {
  readonly config: ViewConfig;
  readonly capability: ViewCapability;
  readonly modified: boolean;
  readonly onChange: (next: ViewConfig) => void;
  readonly compact?: boolean;
}

function toggleProperty(
  properties: readonly DisplayProperty[],
  property: DisplayProperty,
): DisplayProperty[] {
  return properties.includes(property)
    ? properties.filter((entry) => entry !== property)
    : DISPLAY_PROPERTIES.filter((entry) => entry === property || properties.includes(entry));
}

export function DisplayMenu({
  config,
  capability,
  modified,
  onChange,
  compact = false,
}: DisplayMenuProps) {
  const setDisplay = (patch: Partial<ViewConfig['display']>) => {
    onChange({ ...config, display: { ...config.display, ...patch } });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          data-testid="display-menu-trigger"
          aria-label="Display options"
          className={compact ? 'relative size-9 px-0 sm:size-7' : 'relative'}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          {compact ? null : 'Display'}
          {modified ? (
            <span
              data-testid="display-modified-dot"
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
        data-testid="display-menu"
      >
        <DropdownMenuLabel>Grouping</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.groupBy}
          onValueChange={(value) => onChange({ ...config, groupBy: value as GroupByField })}
        >
          {capability.groupBy.map((field) => (
            <DropdownMenuRadioItem key={field} value={field} data-testid={`group-by-${field}`}>
              {GROUP_BY_LABELS[field]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {capability.subGrouping ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sub-grouping</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={config.subGroupBy}
              onValueChange={(value) => onChange({ ...config, subGroupBy: value as GroupByField })}
            >
              {capability.subGroupBy
                .filter((field) => field === 'none' || field !== config.groupBy)
                .map((field) => (
                  <DropdownMenuRadioItem
                    key={field}
                    value={field}
                    data-testid={`sub-group-by-${field}`}
                  >
                    {GROUP_BY_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Ordering</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.orderBy}
          onValueChange={(value) => onChange({ ...config, orderBy: value as IssueOrdering })}
        >
          {capability.orderBy.map((ordering) => (
            <DropdownMenuRadioItem
              key={ordering}
              value={ordering}
              data-testid={`order-by-${ordering}`}
            >
              {ISSUE_ORDERING_LABELS[ordering]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Completed issues</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.display.showCompleted}
          onValueChange={(value) => setDisplay({ showCompleted: value as CompletedWindow })}
        >
          {COMPLETED_WINDOWS.map((window) => (
            <DropdownMenuRadioItem
              key={window}
              value={window}
              data-testid={`show-completed-${window}`}
            >
              {COMPLETED_WINDOW_LABELS[window]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={config.display.showSubIssues}
          data-testid="toggle-sub-issues"
          onSelect={(event) => {
            event.preventDefault();
            setDisplay({ showSubIssues: !config.display.showSubIssues });
          }}
        >
          Show sub-issues
        </DropdownMenuCheckboxItem>
        {capability.showEmptyGroups ? (
          <DropdownMenuCheckboxItem
            checked={config.display.showEmptyGroups}
            data-testid="toggle-empty-groups"
            onSelect={(event) => {
              event.preventDefault();
              setDisplay({ showEmptyGroups: !config.display.showEmptyGroups });
            }}
          >
            Show empty groups
          </DropdownMenuCheckboxItem>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Properties</DropdownMenuLabel>
        {capability.properties.map((property) => (
          <DropdownMenuCheckboxItem
            key={property}
            checked={config.display.properties.includes(property)}
            data-testid={`property-${property}`}
            onSelect={(event) => {
              event.preventDefault();
              setDisplay({ properties: toggleProperty(config.display.properties, property) });
            }}
          >
            {DISPLAY_PROPERTY_LABELS[property]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
