'use client';

import type { OrgRole } from '@orbit/shared/constants';
import { permissionsFor } from '@orbit/shared/policy';
import { Trash2 } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/ui/dropdown-menu.tsx';
import { keyGlyph } from '@/components/ui/kbd.tsx';
import { dangerMenuAction } from '@/lib/interaction.ts';
import { formatBinding } from '@/lib/keyboard/index.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useDeleteIssues } from '@/lib/query/use-issues.ts';
import { useWorkspace } from './workspace-provider.tsx';

export const DELETE_ISSUE_BINDING = 'mod+shift+backspace';

export interface DeleteRequest {
  readonly issues: readonly Issue[];
  readonly onDeleted?: (() => void) | undefined;
}

export interface IssueDeletion {
  readonly allowed: boolean;
  readonly request: (input: DeleteRequest) => void;
}

const IssueDeletionContext = createContext<IssueDeletion | null>(null);

export function useIssueDeletion(): IssueDeletion | null {
  return useContext(IssueDeletionContext);
}

export function canDeleteIssues(role: OrgRole): boolean {
  return permissionsFor(role).includes('issue:delete');
}

export function describeDeletion(issues: readonly Issue[]): {
  readonly title: string;
  readonly body: string;
} {
  const first = issues[0];
  if (issues.length === 1 && first !== undefined) {
    return {
      title: `Delete ${first.identifier}?`,
      body: `"${first.title}" and its comments, activity and history are removed for everyone, for good. Deleting cannot be undone, so pick Cancel if you only want the issue out of your way.`,
    };
  }
  return {
    title: `Delete ${issues.length} issues?`,
    body: `All ${issues.length} selected issues, with their comments, activity and history, are removed for everyone, for good. Deleting cannot be undone.`,
  };
}

export function IssueDeletionProvider({ children }: { readonly children: ReactNode }) {
  const workspace = useWorkspace();
  const remove = useDeleteIssues();
  const [request, setRequest] = useState<DeleteRequest | null>(null);

  const allowed = useMemo(() => canDeleteIssues(workspace.role), [workspace.role]);

  const open = useCallback(
    (input: DeleteRequest) => {
      if (!allowed || input.issues.length === 0) return;
      setRequest((current) => current ?? input);
    },
    [allowed],
  );

  const value = useMemo<IssueDeletion>(() => ({ allowed, request: open }), [allowed, open]);

  const confirm = () => {
    if (request === null) return;
    const { issues, onDeleted } = request;
    setRequest(null);
    remove.mutate(issues, {
      onSuccess: () => {
        onDeleted?.();
      },
    });
  };

  const copy = describeDeletion(request?.issues ?? []);

  return (
    <IssueDeletionContext.Provider value={value}>
      {children}
      <Dialog
        open={request !== null}
        onOpenChange={(next) => {
          if (!next) setRequest(null);
        }}
      >
        <DialogContent className="max-w-sm" data-testid="delete-issue-dialog">
          <DialogHeader>
            <DialogTitle className="font-medium text-base text-text">{copy.title}</DialogTitle>
            <DialogDescription className="text-muted text-xs">{copy.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRequest(null)}>
              Cancel
            </Button>
            <Button variant="danger" data-testid="confirm-delete-issue" onClick={confirm}>
              {request !== null && request.issues.length > 1
                ? `Delete ${request.issues.length} issues`
                : 'Delete issue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IssueDeletionContext.Provider>
  );
}

export interface DeleteIssueMenuItemProps {
  readonly issue: Issue;
  readonly onDeleted?: (() => void) | undefined;
}

export function DeleteIssueMenuItem({ issue, onDeleted }: DeleteIssueMenuItemProps) {
  const deletion = useIssueDeletion();
  if (deletion?.allowed !== true) return null;

  return (
    <DropdownMenuItem
      data-testid={`delete-issue-${issue.identifier}`}
      className={dangerMenuAction}
      onSelect={() => deletion.request({ issues: [issue], onDeleted })}
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
      Delete issue
      <DropdownMenuShortcut>
        {formatBinding(DELETE_ISSUE_BINDING).map(keyGlyph).join(' ')}
      </DropdownMenuShortcut>
    </DropdownMenuItem>
  );
}
