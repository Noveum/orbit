'use client';

import { DEFAULT_ESTIMATE_SCALE, PRIORITIES } from '@orbit/shared/constants';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useUpdateIssue } from '@/lib/query/use-issues.ts';
import { PriorityGlyph, priorityLabel } from './priority-glyph.tsx';
import { PropertyMenu } from './property-menu.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

type MenuKey = 'status' | 'priority' | 'assignee' | 'project' | 'cycle' | 'labels' | 'estimate';

const rowClassName =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-dense text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-2';

export interface IssuePropertiesProps {
  readonly issue: Issue;
}

export function IssueProperties({ issue }: IssuePropertiesProps) {
  const workspace = useWorkspace();
  const update = useUpdateIssue(issue.teamId);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const states = statesForTeam(workspace.states, issue.teamId);
  const state = workspace.stateById.get(issue.stateId);
  const assignee =
    issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId);
  const project = workspace.projects.find((entry) => entry.id === issue.projectId);
  const cycles = workspace.cycles.filter((cycle) => cycle.teamId === issue.teamId);
  const cycle = cycles.find((entry) => entry.id === issue.cycleId);
  const teamLabels = workspace.labels.filter(
    (label) => label.teamId === null || label.teamId === issue.teamId,
  );

  const patch = (values: Parameters<typeof update.mutate>[0]['patch']) => {
    update.mutate({ issue, patch: values });
  };

  const toggle = (key: MenuKey) => (open: boolean) => setOpenMenu(open ? key : null);

  useHotkey('s', () => setOpenMenu('status'), { label: 'Change status', section: 'Issues' });
  useHotkey('p', () => setOpenMenu('priority'), { label: 'Change priority', section: 'Issues' });
  useHotkey('a', () => setOpenMenu('assignee'), { label: 'Assign issue', section: 'Issues' });
  useHotkey('i', () => setOpenMenu('project'), { label: 'Change project', section: 'Issues' });
  useHotkey('l', () => setOpenMenu('labels'), { label: 'Change labels', section: 'Issues' });
  useHotkey('shift+e', () => setOpenMenu('estimate'), {
    label: 'Change estimate',
    section: 'Issues',
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

      <PropertyRow label="Cycle">
        <PropertyMenu
          title="Cycle"
          open={openMenu === 'cycle'}
          onOpenChange={toggle('cycle')}
          options={[
            { id: 'none', label: 'No cycle' },
            ...cycles.map((entry) => ({
              id: entry.id,
              label: entry.name.length > 0 ? entry.name : `Cycle ${entry.number}`,
            })),
          ]}
          selected={issue.cycleId === null ? ['none'] : [issue.cycleId]}
          onSelect={(value) => patch({ cycleId: value === 'none' ? null : value })}
        >
          <button type="button" className={rowClassName} data-testid="property-cycle">
            {cycle === undefined ? 'No cycle' : `Cycle ${cycle.number}`}
          </button>
        </PropertyMenu>
      </PropertyRow>
    </aside>
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
