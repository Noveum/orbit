'use client';

import { issuePrompt } from '@orbit/shared/utils';
import { ClipboardList, GitBranch, Hash, Link2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { branchCopy } from './copy-branch-name.tsx';
import { priorityLabel } from './priority-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export function absoluteIssueUrl(identifier: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/issue/${identifier}`;
}

export interface IssueCopyActionsProps {
  readonly issue: Issue;
}

export function IssueCopyActions({ issue }: IssueCopyActionsProps) {
  const workspace = useWorkspace();
  const { toast } = useToast();
  const { branch, ready } = branchCopy(workspace, issue);

  const copy = async (label: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: label, description: value.split('\n')[0] ?? value });
    } catch {
      toast({ title: `Could not copy the ${label.toLowerCase()}`, tone: 'danger' });
    }
  };

  const promptText = (): string => {
    const team = workspace.teams.find((entry) => entry.id === issue.teamId);
    const state = workspace.stateById.get(issue.stateId);
    const assignee =
      issue.assigneeId === null ? null : (workspace.memberById.get(issue.assigneeId)?.name ?? null);
    const project =
      issue.projectId === null
        ? null
        : (workspace.projects.find((entry) => entry.id === issue.projectId)?.name ?? null);
    const labels = issue.labelIds
      .map((id) => workspace.labelById.get(id)?.name)
      .filter((name): name is string => name !== undefined);

    return issuePrompt({
      identifier: issue.identifier,
      title: issue.title,
      branch,
      team: team?.name ?? null,
      state: state?.name ?? null,
      priority: issue.priority === 0 ? null : priorityLabel(issue.priority),
      assignee,
      project,
      labels,
      description: issue.description,
      url: absoluteIssueUrl(issue.identifier, window.location.origin),
    });
  };

  const actions = [
    {
      id: 'link',
      label: 'Copy link',
      toastLabel: 'Link copied',
      icon: Link2,
      value: () => absoluteIssueUrl(issue.identifier, window.location.origin),
      enabled: true,
    },
    {
      id: 'id',
      label: 'Copy issue ID',
      toastLabel: 'Issue ID copied',
      icon: Hash,
      value: () => issue.identifier,
      enabled: true,
    },
    {
      id: 'branch',
      label: 'Copy branch name',
      toastLabel: 'Branch name copied',
      icon: GitBranch,
      value: () => branch,
      enabled: ready,
    },
    {
      id: 'prompt',
      label: 'Copy as prompt',
      toastLabel: 'Prompt copied',
      icon: ClipboardList,
      value: promptText,
      enabled: ready,
    },
  ] as const;

  return (
    <div className="flex items-center gap-0.5">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Tooltip key={action.id} label={action.label}>
            <button
              type="button"
              aria-label={action.label}
              disabled={!action.enabled}
              data-testid={`issue-copy-${action.id}`}
              onClick={() => {
                copy(action.toastLabel, action.value()).catch(() => undefined);
              }}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-muted',
                'disabled:cursor-not-allowed disabled:opacity-50',
                rowHover,
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
