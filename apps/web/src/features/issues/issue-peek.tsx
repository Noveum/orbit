'use client';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { PriorityGlyph, priorityLabel } from './priority-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface IssuePeekProps {
  readonly issue: Issue | undefined;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}

export function IssuePeek({ issue, onClose, onOpen }: IssuePeekProps) {
  const { stateById, memberById } = useWorkspace();
  if (issue === undefined) return null;

  const state = stateById.get(issue.stateId);
  const assignee = issue.assigneeId === null ? undefined : memberById.get(issue.assigneeId);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="issue-peek" className="max-w-xl">
        <DialogTitle className="pr-8 font-medium text-lg text-text">{issue.title}</DialogTitle>
        <p className="mt-1 text-2xs text-faint" data-numeric>
          {issue.identifier}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-dense">
          <div>
            <dt className="text-2xs text-faint uppercase">Status</dt>
            <dd className="text-text">{state?.name ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-2xs text-faint uppercase">Priority</dt>
            <dd className="flex items-center gap-1.5 text-text">
              <PriorityGlyph priority={issue.priority} />
              {priorityLabel(issue.priority)}
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-faint uppercase">Assignee</dt>
            <dd className="text-text">{assignee?.name ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-2xs text-faint uppercase">Estimate</dt>
            <dd className="text-text">{issue.estimate ?? 'None'}</dd>
          </div>
        </dl>
        {issue.description.length > 0 ? (
          <p className="mt-4 line-clamp-6 whitespace-pre-wrap text-dense text-muted">
            {issue.description}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="primary" onClick={onOpen}>
            Open issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
