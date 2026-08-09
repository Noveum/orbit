'use client';

import { type ReactNode, useState } from 'react';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useIssueSearch } from '@/lib/query/use-issue-search.ts';

export function pickableIssues(
  issues: readonly Issue[],
  excludedIds: readonly string[],
): readonly Issue[] {
  return issues.filter((issue) => !excludedIds.includes(issue.id));
}

export interface IssuePickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (issue: Issue) => void;
  readonly excludedIds: readonly string[];
  readonly placeholder?: string;
  readonly testId?: string;
  readonly header?: ReactNode;
  readonly children: ReactNode;
}

export function IssuePicker({
  open,
  onOpenChange,
  onPick,
  excludedIds,
  placeholder = 'Search issues by title or identifier',
  testId = 'issue-picker',
  header,
  children,
}: IssuePickerProps) {
  const [term, setTerm] = useState('');
  const { issues, searching } = useIssueSearch(open ? term : '');
  const options = pickableIssues(issues, excludedIds);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setTerm('');
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="flex w-72 flex-col gap-1 p-2" data-testid={testId}>
        {header}
        <Input
          autoFocus
          value={term}
          aria-label={placeholder}
          placeholder={placeholder}
          data-testid={`${testId}-search`}
          onChange={(event) => setTerm(event.currentTarget.value)}
        />
        <ul className="flex max-h-64 flex-col overflow-y-auto">
          {options.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                data-testid={`${testId}-option-${issue.identifier}`}
                onClick={() => {
                  setTerm('');
                  onPick(issue);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense',
                  rowHover,
                )}
              >
                <span data-numeric className="shrink-0 text-2xs text-faint">
                  {issue.identifier}
                </span>
                <span className="truncate text-text">{issue.title}</span>
              </button>
            </li>
          ))}
        </ul>
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-faint" data-testid={`${testId}-empty`}>
            {searching ? 'Searching' : 'Type at least two characters to find an issue.'}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
