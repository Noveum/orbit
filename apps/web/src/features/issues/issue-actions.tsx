'use client';

import { MoreHorizontal } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { DeleteIssueMenuItem, useIssueDeletion } from './issue-deletion.tsx';

export interface IssueActionsMenuProps {
  readonly issue: Issue;
  readonly onDeleted?: (() => void) | undefined;
  readonly className?: string;
}

export function IssueActionsMenu({ issue, onDeleted, className }: IssueActionsMenuProps) {
  const deletion = useIssueDeletion();
  if (deletion?.allowed !== true) return null;

  const swallow = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${issue.identifier}`}
        data-testid={`issue-actions-${issue.identifier}`}
        onPointerDown={swallow}
        className={cn(
          'relative z-10 flex size-5 shrink-0 items-center justify-center rounded-sm text-faint',
          'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] motion-reduce:transition-none',
          'hover:bg-surface-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          className,
        )}
      >
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DeleteIssueMenuItem issue={issue} onDeleted={onDeleted} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
