'use client';

import { PRIORITIES } from '@orbit/shared/constants';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useCreateIssue } from '@/lib/query/use-issues.ts';
import { PriorityGlyph, priorityLabel } from './priority-glyph.tsx';
import { PropertyMenu } from './property-menu.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

export interface QuickCreateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultTeamId: string | null;
}

const chipClassName =
  'flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-2xs text-muted transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:text-text';

export function QuickCreateDialog({ open, onOpenChange, defaultTeamId }: QuickCreateDialogProps) {
  const { teams, states, members, labels, ready } = useWorkspace();
  const firstTeamId = defaultTeamId ?? teams[0]?.id ?? null;
  const [teamId, setTeamId] = useState<string | null>(firstTeamId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<readonly string[]>([]);

  const create = useCreateIssue(teamId ?? 'none');

  useEffect(() => {
    if (!open) return;
    setTeamId(defaultTeamId ?? teams[0]?.id ?? null);
    setTitle('');
    setDescription('');
    setStateId(null);
    setPriority(0);
    setAssigneeId(null);
    setLabelIds([]);
  }, [open, defaultTeamId, teams]);

  const teamStates = statesForTeam(states, teamId);
  const teamLabels = labels.filter((label) => label.teamId === null || label.teamId === teamId);
  const selectedState = teamStates.find((state) => state.id === stateId);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (teamId === null || title.trim().length === 0) return;
    create.mutate(
      {
        teamId,
        title: title.trim(),
        description,
        ...(stateId === null ? {} : { stateId }),
        priority,
        assigneeId,
        projectId: null,
        cycleId: null,
        estimate: null,
        labelIds,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="quick-create" className="max-w-xl">
        <DialogTitle className="sr-only">Create issue</DialogTitle>
        <form
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          className="flex flex-col gap-3"
        >
          <Input
            autoFocus
            data-testid="quick-create-title"
            placeholder="Issue title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 border-0 px-0 font-medium text-base shadow-none focus-visible:outline-none"
          />
          <Textarea
            data-testid="quick-create-description"
            rows={4}
            placeholder="Add a description, markdown works."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="resize-none border-0 px-0 shadow-none focus-visible:outline-none"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <PropertyMenu
              title="Team"
              options={teams.map((team) => ({ id: team.id, label: team.name }))}
              selected={teamId === null ? [] : [teamId]}
              onSelect={(id) => {
                setTeamId(id);
                setStateId(null);
              }}
            >
              <button type="button" className={chipClassName}>
                {teams.find((team) => team.id === teamId)?.key ?? 'Team'}
              </button>
            </PropertyMenu>

            <PropertyMenu
              title="Status"
              options={teamStates.map((state) => ({
                id: state.id,
                label: state.name,
                icon: <StateGlyph category={state.category} color={state.color} />,
              }))}
              selected={stateId === null ? [] : [stateId]}
              onSelect={setStateId}
            >
              <button type="button" className={chipClassName}>
                {selectedState === undefined ? null : (
                  <StateGlyph category={selectedState.category} color={selectedState.color} />
                )}
                {selectedState?.name ?? 'Status'}
              </button>
            </PropertyMenu>

            <PropertyMenu
              title="Priority"
              options={PRIORITIES.map((value) => ({
                id: String(value),
                label: priorityLabel(value),
                icon: <PriorityGlyph priority={value} />,
              }))}
              selected={[String(priority)]}
              onSelect={(value) => setPriority(Number(value))}
            >
              <button type="button" className={chipClassName}>
                <PriorityGlyph priority={priority} />
                {priorityLabel(priority)}
              </button>
            </PropertyMenu>

            <PropertyMenu
              title="Assignee"
              options={[
                { id: 'none', label: 'No assignee' },
                ...members.map((member) => ({ id: member.id, label: member.name })),
              ]}
              selected={assigneeId === null ? ['none'] : [assigneeId]}
              onSelect={(value) => setAssigneeId(value === 'none' ? null : value)}
            >
              <button type="button" className={chipClassName}>
                {members.find((member) => member.id === assigneeId)?.name ?? 'Assignee'}
              </button>
            </PropertyMenu>

            <PropertyMenu
              title="Labels"
              multiple
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
              selected={labelIds}
              onSelect={(id) =>
                setLabelIds((current) =>
                  current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
                )
              }
            >
              <button type="button" className={chipClassName}>
                {labelIds.length === 0 ? 'Labels' : `${labelIds.length} labels`}
              </button>
            </PropertyMenu>
          </div>

          <div className="flex items-center justify-end gap-2 border-border border-t pt-3">
            <span className="mr-auto flex items-center gap-1 text-2xs text-faint">
              <Kbd keys={['mod', 'enter']} /> to create
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              data-testid="quick-create-submit"
              disabled={!ready || title.trim().length === 0 || create.isPending}
            >
              Create issue
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
