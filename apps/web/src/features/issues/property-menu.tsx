'use client';

import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

export interface PropertyOption {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
}

interface PropertyMenuBaseProps {
  readonly title: string;
  readonly options: readonly PropertyOption[];
  readonly selected: readonly string[];
  readonly multiple?: boolean;
  readonly onSelect: (id: string) => void;
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  readonly testId?: string;
}

type ControlledProps =
  | { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }
  | { readonly open?: undefined; readonly onOpenChange?: undefined };

export type PropertyMenuProps = PropertyMenuBaseProps & ControlledProps;

export function PropertyMenu({
  title,
  options,
  selected,
  multiple = false,
  open,
  onOpenChange,
  onSelect,
  children,
  align = 'start',
  testId,
}: PropertyMenuProps) {
  return (
    <DropdownMenu
      {...(open === undefined || onOpenChange === undefined ? {} : { open, onOpenChange })}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-80 overflow-y-auto"
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {multiple ? (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selected.includes(option.id)}
              onSelect={(event) => {
                event.preventDefault();
                onSelect(option.id);
              }}
            >
              <OptionLabel option={option} />
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <DropdownMenuRadioGroup value={selected[0] ?? ''} onValueChange={onSelect}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                <OptionLabel option={option} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionLabel({ option }: { option: PropertyOption }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {option.icon}
      <span className="truncate">{option.label}</span>
    </span>
  );
}
