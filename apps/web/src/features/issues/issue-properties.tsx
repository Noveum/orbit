'use client';

import { DEFAULT_ESTIMATE_SCALE, PRIORITIES } from '@orbit/shared/constants';
import { sprintLabel } from '@orbit/shared/utils';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { cn } from '@/lib/cn.ts';
import { dangerMenuAction, rowHover } from '@/lib/interaction.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Issue, Milestone } from '@/lib/query/schemas.ts';
import { useUpdateIssue } from '@/lib/query/use-issues.ts';
import { useMilestones } from '@/lib/query/use-milestones.ts';
import { DueDateField } from './due-date-field.tsx';
import { useIssueDeletion } from './issue-deletion.tsx';
import { IssuePicker } from './issue-picker.tsx';
import { PriorityGlyph, priorityLabel } from './priority-glyph.tsx';
import { PropertyMenu } from './property-menu.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

type MenuKey =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'milestone'
  | 'cycle'
  | 'labels'
  | 'estimate'
  | 'dueDate'
  | 'parent';

const rowClassName = cn(
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense text-text',
  rowHover,
);

export interface IssuePropertiesProps {
  readonly issue: Issue;
  readonly parent?: Issue | null;
  readonly onDeleted?: (() => void) | undefined;
}

export function IssueProperties({ issue, parent = null, onDeleted }: IssuePropertiesProps) {
  const workspace = useWorkspace();
  const update = useUpdateIssue();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const states = statesForTeam(workspace.states, issue.teamId);
  const state = workspace.stateById.get(issue.stateId);
  const assignee =
    issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId);
  const project = workspace.projects.find((entry) => entry.id === issue.projectId);
  const milestonesQuery = useMilestones(issue.projectId);
  const milestones = milestonesQuery.data ?? [];
  const cycles = workspace.cycles.filter((cycle) => cycle.teamId === issue.teamId);
  const cycle = cycles.find((entry) => entry.id === issue.cycleId);
  const teamLabels = workspace.labels.filter(
    (label) => label.teamId === null || label.teamId === issue.teamId,
  );
  const parentLabel =
    issue.parentId === null ? 'No parent' : (parent?.identifier ?? 'Parent issue');

  const patch = (values: Parameters<typeof update.mutate>[0]['patch']) => {
    update.mutate({ issue, patch: values });
  };

  const toggle = (key: MenuKey) => (open: boolean) => setOpenMenu(open ? key : null);

  useHotkey('s', () => setOpenMenu('status'), {
    label: 'Change status',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('p', () => setOpenMenu('priority'), {
    label: 'Change priority',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('a', () => setOpenMenu('assignee'), {
    label: 'Assign issue',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('i', () => setOpenMenu('project'), {
    label: 'Change project',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('l', () => setOpenMenu('labels'), {
    label: 'Change labels',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('shift+e', () => setOpenMenu('estimate'), {
    label: 'Change estimate',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('shift+d', () => setOpenMenu('dueDate'), {
    label: 'Change due date',
    section: 'Issues',
    scope: 'issues',
  });
  useHotkey('m', () => setOpenMenu('milestone'), {
    label: 'Change milestone',
    section: 'Issues',
    scope: 'issues',
    enabled: issue.projectId !== null,
  });

  return (
    <aside
      data-testid="issue-properties"
      className="flex w-full shrink-0 flex-col gap-0.5 border-border border-t p-3 lg:w-64 lg:border-t-0 lg:border-l"
    >
      <PropertyRow label="Status" shortcut="s">
        <PropertyMenu
          title="Status"
          open={openMenu === 'status'}
          onOpenChange={toggle('status')}
          options={states.map((entry) => ({
            id: entry.id,
            label: entry.name,
            icon: <StateGlyph category={entry.category} color={entry.color} />,
          }))}
          selected={[issue.stateId]}
          onSelect={(stateId) => patch({ stateId })}
          testId="menu-status"
        >
          <button type="button" className={rowClassName} data-testid="property-status">
            {state === undefined ? null : (
              <StateGlyph category={state.category} color={state.color} />
            )}
            {state?.name ?? 'Unknown'}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <PropertyRow label="Priority" shortcut="p">
        <PropertyMenu
          title="Priority"
          open={openMenu === 'priority'}
          onOpenChange={toggle('priority')}
          options={PRIORITIES.map((value) => ({
            id: String(value),
            label: priorityLabel(value),
            icon: <PriorityGlyph priority={value} />,
          }))}
          selected={[String(issue.priority)]}
          onSelect={(value) => patch({ priority: Number(value) })}
        >
          <button type="button" className={rowClassName} data-testid="property-priority">
            <PriorityGlyph priority={issue.priority} />
            {priorityLabel(issue.priority)}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <PropertyRow label="Assignee" shortcut="a">
        <PropertyMenu
          title="Assignee"
          open={openMenu === 'assignee'}
          onOpenChange={toggle('assignee')}
          options={[
            { id: 'none', label: 'No assignee' },
            ...workspace.members.map((member) => ({
              id: member.id,
              label: member.name,
              icon: <Avatar name={member.name} src={member.image} size="xs" />,
            })),
          ]}
          selected={issue.assigneeId === null ? ['none'] : [issue.assigneeId]}
          onSelect={(value) => patch({ assigneeId: value === 'none' ? null : value })}
        >
          <button type="button" className={rowClassName} data-testid="property-assignee">
            {assignee === undefined ? (
              <span className="size-4.5 rounded-full border border-border border-dashed" />
            ) : (
              <Avatar name={assignee.name} src={assignee.image} size="xs" />
            )}
            {assignee?.name ?? 'Unassigned'}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <PropertyRow label="Estimate" shortcut="shift+e">
        <PropertyMenu
          title="Estimate"
          open={openMenu === 'estimate'}
          onOpenChange={toggle('estimate')}
          options={[
            { id: 'none', label: 'No estimate' },
            ...DEFAULT_ESTIMATE_SCALE.map((points) => ({
              id: String(points),
              label: `${points} points`,
            })),
          ]}
          selected={issue.estimate === null ? ['none'] : [String(issue.estimate)]}
          onSelect={(value) => patch({ estimate: value === 'none' ? null : Number(value) })}
        >
          <button type="button" className={rowClassName} data-testid="property-estimate">
            {issue.estimate === null ? 'No estimate' : `${issue.estimate} points`}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <PropertyRow label="Labels" shortcut="l">
        <PropertyMenu
          title="Labels"
          multiple
          open={openMenu === 'labels'}
          onOpenChange={toggle('labels')}
          options={teamLabels.map((label) => ({
            id: label.id,
            label: label.name,
            icon: (
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
                aria-hidden="true"
              />
            ),
          }))}
          selected={issue.labelIds}
          onSelect={(labelId) =>
            patch({
              labelIds: issue.labelIds.includes(labelId)
                ? issue.labelIds.filter((entry) => entry !== labelId)
                : [...issue.labelIds, labelId],
            })
          }
        >
          <button type="button" className={rowClassName} data-testid="property-labels">
            {issue.labelIds.length === 0
              ? 'No labels'
              : issue.labelIds.map((id) => workspace.labelById.get(id)?.name ?? 'Label').join(', ')}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <PropertyRow label="Project" shortcut="i">
        <PropertyMenu
          title="Project"
          open={openMenu === 'project'}
          onOpenChange={toggle('project')}
          options={[
            { id: 'none', label: 'No project' },
            ...workspace.projects.map((entry) => ({ id: entry.id, label: entry.name })),
          ]}
          selected={issue.projectId === null ? ['none'] : [issue.projectId]}
          onSelect={(value) => patch({ projectId: value === 'none' ? null : value })}
        >
          <button type="button" className={rowClassName} data-testid="property-project">
            {project?.name ?? 'No project'}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <MilestoneProperty
        issue={issue}
        milestones={milestones}
        open={openMenu === 'milestone'}
        onOpenChange={toggle('milestone')}
        onSelect={(milestoneId) => patch({ milestoneId })}
      />

      <PropertyRow label="Due date" shortcut="shift+d">
        <DueDateField
          value={issue.dueDate}
          open={openMenu === 'dueDate'}
          onOpenChange={toggle('dueDate')}
          onChange={(dueDate) => patch({ dueDate })}
          triggerClassName={rowClassName}
        />
      </PropertyRow>

      <PropertyRow label="Parent">
        <div className="flex items-center gap-1">
          <IssuePicker
            open={openMenu === 'parent'}
            onOpenChange={toggle('parent')}
            excludedIds={[issue.id, ...(issue.parentId === null ? [] : [issue.parentId])]}
            testId="parent-picker"
            placeholder="Search for a parent issue"
            onPick={(picked) => patch({ parentId: picked.id })}
          >
            <button type="button" className={rowClassName} data-testid="property-parent">
              {parentLabel}
            </button>
          </IssuePicker>
          {issue.parentId === null ? null : (
            <button
              type="button"
              aria-label="Clear parent"
              data-testid="clear-parent"
              onClick={() => patch({ parentId: null })}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-text',
                rowHover,
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </PropertyRow>

      <PropertyRow label="Sprint">
        <PropertyMenu
          title="Sprint"
          open={openMenu === 'cycle'}
          onOpenChange={toggle('cycle')}
          options={[
            { id: 'none', label: 'No sprint' },
            ...cycles.map((entry) => ({
              id: entry.id,
              label: sprintLabel(entry),
            })),
          ]}
          selected={issue.cycleId === null ? ['none'] : [issue.cycleId]}
          onSelect={(value) => patch({ cycleId: value === 'none' ? null : value })}
        >
          <button type="button" className={rowClassName} data-testid="property-cycle">
            {cycle === undefined ? 'No sprint' : sprintLabel(cycle)}
          </button>
        </PropertyMenu>
      </PropertyRow>

      <DeleteIssueRow issue={issue} onDeleted={onDeleted} />
    </aside>
  );
}

function DeleteIssueRow({
  issue,
  onDeleted,
}: {
  readonly issue: Issue;
  readonly onDeleted?: (() => void) | undefined;
}) {
  const deletion = useIssueDeletion();
  if (deletion?.allowed !== true) return null;

  return (
    <div className="mt-1 border-border border-t pt-2">
      <button
        type="button"
        data-testid="property-delete-issue"
        onClick={() => deletion.request({ issues: [issue], onDeleted })}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense',
          dangerMenuAction,
        )}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete issue
      </button>
    </div>
  );
}

function MilestoneProperty({
  issue,
  milestones,
  open,
  onOpenChange,
  onSelect,
}: {
  readonly issue: Issue;
  readonly milestones: readonly Milestone[];
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly onSelect: (milestoneId: string | null) => void;
}) {
  if (issue.projectId === null) {
    return (
      <PropertyRow label="Milestone">
        <p className="px-2 py-1.5 text-dense text-faint" data-testid="property-milestone-empty">
          Pick a project first
        </p>
      </PropertyRow>
    );
  }
  const current = milestones.find((entry) => entry.id === issue.milestoneId);
  return (
    <PropertyRow label="Milestone" shortcut="m">
      <PropertyMenu
        title="Milestone"
        open={open}
        onOpenChange={onOpenChange}
        options={[
          { id: 'none', label: 'No milestone' },
          ...milestones.map((entry) => ({ id: entry.id, label: entry.name })),
        ]}
        selected={issue.milestoneId === null ? ['none'] : [issue.milestoneId]}
        onSelect={(value) => onSelect(value === 'none' ? null : value)}
        testId="menu-milestone"
      >
        <button type="button" className={rowClassName} data-testid="property-milestone">
          {current?.name ?? 'No milestone'}
        </button>
      </PropertyMenu>
    </PropertyRow>
  );
}

function PropertyRow({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <span className="text-2xs text-faint uppercase tracking-wide">{label}</span>
        {shortcut === undefined ? null : <Kbd keys={shortcut.split('+')} className="opacity-60" />}
      </div>
      {children}
    </div>
  );
}
