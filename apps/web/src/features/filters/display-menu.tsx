'use client';

import { GROUP_BY_FIELDS, type GroupByField } from '@orbit/shared/filters';
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
import type { IssueOrdering, IssueProperty, ViewConfig } from './view-config.ts';
import {
  GROUP_BY_LABELS,
  ISSUE_ORDERING_LABELS,
  ISSUE_ORDERINGS,
  ISSUE_PROPERTIES,
  ISSUE_PROPERTY_LABELS,
} from './view-config.ts';

export interface DisplayMenuProps {
  readonly config: ViewConfig;
  readonly onChange: (next: ViewConfig) => void;
}

function toggleProperty(
  properties: readonly IssueProperty[],
  property: IssueProperty,
): IssueProperty[] {
  return properties.includes(property)
    ? properties.filter((entry) => entry !== property)
    : ISSUE_PROPERTIES.filter((entry) => entry === property || properties.includes(entry));
}

export function DisplayMenu({ config, onChange }: DisplayMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-testid="display-menu-trigger">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          Display
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto"
        data-testid="display-menu"
      >
        <DropdownMenuLabel>Grouping</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.groupBy}
          onValueChange={(value) => onChange({ ...config, groupBy: value as GroupByField })}
        >
          {GROUP_BY_FIELDS.map((field) => (
            <DropdownMenuRadioItem key={field} value={field} data-testid={`group-by-${field}`}>
              {GROUP_BY_LABELS[field]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Ordering</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={config.orderBy}
          onValueChange={(value) => onChange({ ...config, orderBy: value as IssueOrdering })}
        >
          {ISSUE_ORDERINGS.map((ordering) => (
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
        <DropdownMenuCheckboxItem
          checked={config.showSubIssues}
          data-testid="toggle-sub-issues"
          onSelect={(event) => {
            event.preventDefault();
            onChange({ ...config, showSubIssues: !config.showSubIssues });
          }}
        >
          Show sub-issues
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={config.showEmptyGroups}
          data-testid="toggle-empty-groups"
          onSelect={(event) => {
            event.preventDefault();
            onChange({ ...config, showEmptyGroups: !config.showEmptyGroups });
          }}
        >
          Show empty groups
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Properties</DropdownMenuLabel>
        {ISSUE_PROPERTIES.map((property) => (
          <DropdownMenuCheckboxItem
            key={property}
            checked={config.properties.includes(property)}
            data-testid={`property-${property}`}
            onSelect={(event) => {
              event.preventDefault();
              onChange({ ...config, properties: toggleProperty(config.properties, property) });
            }}
          >
            {ISSUE_PROPERTY_LABELS[property]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
