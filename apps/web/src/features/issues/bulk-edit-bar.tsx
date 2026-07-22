'use client';

import { PRIORITIES } from '@orbit/shared/constants';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { useUpdateIssue } from '@/lib/query/use-issues.ts';
import { PriorityGlyph, priorityLabel } from './priority-glyph.tsx';
import { PropertyMenu } from './property-menu.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface BulkEditBarProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly issues: readonly Issue[];
  readonly onClear: () => void;
}

export function BulkEditBar({ teamId, states, issues, onClear }: BulkEditBarProps) {
  const update = useUpdateIssue(teamId);
  const { members } = useWorkspace();

  const applyToAll = (patch: Parameters<typeof update.mutate>[0]['patch']) => {
    for (const issue of issues) update.mutate({ issue, patch });
  };

  const sharedValue = (read: (issue: Issue) => string | null): string[] => {
    const values = new Set(issues.map((issue) => read(issue) ?? 'none'));
    const only = [...values];
    return values.size === 1 && only[0] !== undefined ? [only[0]] : [];
  };

  return (
    <div
      data-testid="bulk-edit-bar"
      className="flex items-center gap-2 border-border border-t bg-surface px-3 py-2"
    >
      <span className="font-medium text-dense text-text">{issues.length} selected</span>

      <PropertyMenu
        title="Status"
        options={states.map((state) => ({
          id: state.id,
          label: state.name,
          icon: <StateGlyph category={state.category} color={state.color} />,
        }))}
        selected={sharedValue((issue) => issue.stateId)}
        onSelect={(stateId) => applyToAll({ stateId })}
      >
        <Button size="sm" variant="secondary">
          Status
        </Button>
      </PropertyMenu>

      <PropertyMenu
        title="Priority"
        options={PRIORITIES.map((priority) => ({
          id: String(priority),
          label: priorityLabel(priority),
          icon: <PriorityGlyph priority={priority} />,
        }))}
        selected={sharedValue((issue) => String(issue.priority))}
        onSelect={(value) => applyToAll({ priority: Number(value) })}
      >
        <Button size="sm" variant="secondary">
          Priority
        </Button>
      </PropertyMenu>

      <PropertyMenu
        title="Assignee"
        options={[
          { id: 'none', label: 'No assignee' },
          ...members.map((member) => ({ id: member.id, label: member.name })),
        ]}
        selected={sharedValue((issue) => issue.assigneeId)}
        onSelect={(value) => applyToAll({ assigneeId: value === 'none' ? null : value })}
      >
        <Button size="sm" variant="secondary">
          Assignee
        </Button>
      </PropertyMenu>

      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="size-3.5" aria-hidden="true" />
        Clear
      </Button>
    </div>
  );
}
