'use client';

import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';

export interface PropertyOption {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
}

export interface PropertyMenuProps {
  readonly title: string;
  readonly options: readonly PropertyOption[];
  readonly selected: readonly string[];
  readonly multiple?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onSelect: (id: string) => void;
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  readonly testId?: string;
}

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
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-80 overflow-y-auto"
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {options.map((option) =>
          multiple ? (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selected.includes(option.id)}
              onSelect={(event) => {
                event.preventDefault();
                onSelect(option.id);
              }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => onSelect(option.id)}
              className={cn(selected.includes(option.id) && 'text-text')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
