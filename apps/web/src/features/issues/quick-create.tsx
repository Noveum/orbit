'use client';

import { DEFAULT_ESTIMATE_SCALE, PRIORITIES } from '@orbit/shared/constants';

import { sprintLabel } from '@orbit/shared/utils';
import { ChevronRight } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import {
  RichTextEditor,
  type UploadedAttachment,
} from '@/features/docs/editor/rich-text-editor.tsx';
import { assertUploadable, uploadAttachment } from '@/features/docs/upload.ts';
import { messageOf } from '@/lib/query/fetcher.ts';
import type { Cycle, Issue, Project } from '@/lib/query/schemas.ts';
import { useCreateIssue, useUpdateIssue } from '@/lib/query/use-issues.ts';
import {
  attachPending,
  holdAttachment,
  type PendingAttachment,
  releasePending,
} from './pending-attachments.ts';
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

function pendingLabel(count: number): string {
  const noun = count === 1 ? 'file' : 'files';
  return `${count} ${noun} will be attached once the issue is created.`;
}

function ScopePickers({
  teamProjects,
  teamCycles,
  projectId,
  estimate,
  cycleId,
  onProject,
  onEstimate,
  onCycle,
}: {
  readonly teamProjects: readonly Project[];
  readonly teamCycles: readonly Cycle[];
  readonly projectId: string | null;
  readonly estimate: number | null;
  readonly cycleId: string | null;
  readonly onProject: (id: string | null) => void;
  readonly onEstimate: (points: number | null) => void;
  readonly onCycle: (id: string | null) => void;
}) {
  return (
    <>
      <PropertyMenu
        title="Project"
        options={[
          {
            id: 'none',
            label: teamProjects.length === 0 ? 'No projects on this team' : 'No project',
          },
          ...teamProjects.map((project) => ({ id: project.id, label: project.name })),
        ]}
        selected={projectId === null ? ['none'] : [projectId]}
        onSelect={(value) => onProject(value === 'none' ? null : value)}
      >
        <button type="button" className={chipClassName} data-testid="quick-create-project">
          {teamProjects.find((project) => project.id === projectId)?.name ?? 'Project'}
        </button>
      </PropertyMenu>

      <PropertyMenu
        title="Estimate"
        options={[
          { id: 'none', label: 'No estimate' },
          ...DEFAULT_ESTIMATE_SCALE.map((points) => ({
            id: String(points),
            label: `${points} points`,
          })),
        ]}
        selected={estimate === null ? ['none'] : [String(estimate)]}
        onSelect={(value) => onEstimate(value === 'none' ? null : Number(value))}
      >
        <button type="button" className={chipClassName} data-testid="quick-create-estimate">
          {estimate === null ? 'Estimate' : `${estimate} points`}
        </button>
      </PropertyMenu>

      <PropertyMenu
        title="Sprint"
        options={[
          {
            id: 'none',
            label: teamCycles.length === 0 ? 'No sprints on this team' : 'No sprint',
          },
          ...teamCycles.map((cycle) => ({ id: cycle.id, label: sprintLabel(cycle) })),
        ]}
        selected={cycleId === null ? ['none'] : [cycleId]}
        onSelect={(value) => onCycle(value === 'none' ? null : value)}
      >
        <button type="button" className={chipClassName} data-testid="quick-create-cycle">
          {(() => {
            const found = teamCycles.find((cycle) => cycle.id === cycleId);
            return found === undefined ? 'Sprint' : sprintLabel(found);
          })()}
        </button>
      </PropertyMenu>
    </>
  );
}

export function QuickCreateDialog({ open, onOpenChange, defaultTeamId }: QuickCreateDialogProps) {
  const { teams, states, members, labels, projects, cycles, ready } = useWorkspace();
  const { toast } = useToast();
  const firstTeamId = defaultTeamId ?? teams[0]?.id ?? null;
  const [teamId, setTeamId] = useState<string | null>(firstTeamId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<readonly string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const [composerKey, setComposerKey] = useState(0);

  const create = useCreateIssue(teamId ?? 'none');
  const update = useUpdateIssue();

  const defaultsRef = useRef(firstTeamId);
  defaultsRef.current = firstTeamId;
  const heldRef = useRef<readonly PendingAttachment[]>(pending);
  heldRef.current = pending;

  useEffect(() => {
    if (!open) {
      releasePending(heldRef.current);
      setPending([]);
      return;
    }
    setTeamId(defaultsRef.current);
    setTitle('');
    setDescription('');
    setStateId(null);
    setPriority(0);
    setAssigneeId(null);
    setLabelIds([]);
    setProjectId(null);
    setEstimate(null);
    setCycleId(null);
    setPending([]);
  }, [open]);

  const hold = useCallback(
    (file: File): Promise<UploadedAttachment> => {
      try {
        const contentType = assertUploadable(file);
        const entry = holdAttachment(file);
        setPending((current) => [...current, entry]);
        return Promise.resolve({
          url: entry.placeholder,
          fileName: file.name,
          contentType,
        });
      } catch (error: unknown) {
        const reason = messageOf(error);
        toast({ title: 'Could not attach that file', description: reason, tone: 'danger' });
        return Promise.reject(new Error(reason));
      }
    },
    [toast],
  );

  const finalize = useCallback(
    (issue: Issue, body: string, held: readonly PendingAttachment[]): void => {
      if (held.length === 0) return;
      const run = async (): Promise<void> => {
        const outcome = await attachPending(
          body,
          held,
          async (file) => await uploadAttachment('issue', issue.id, file),
        );
        releasePending(held);
        for (const failure of outcome.failures) {
          toast({
            title: `Could not attach ${failure.fileName}`,
            description: failure.reason,
            tone: 'danger',
          });
        }
        if (outcome.rewritten === 0) return;
        await update.mutateAsync({ issue, patch: { description: outcome.description } });
      };
      run().catch(() => undefined);
    },
    [toast, update],
  );

  const teamStates = statesForTeam(states, teamId);
  const teamLabels = labels.filter((label) => label.teamId === null || label.teamId === teamId);
  const teamProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.teamIds.length === 0 || (teamId !== null && project.teamIds.includes(teamId)),
      ),
    [projects, teamId],
  );

  const teamCycles = useMemo(
    () => cycles.filter((cycle) => cycle.teamId === teamId),
    [cycles, teamId],
  );
  const selectedState = teamStates.find((state) => state.id === stateId);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (create.isPending) return;
    if (teamId === null || title.trim().length === 0) return;
    const body = description;
    const held = pending;
    create.mutate(
      {
        teamId,
        title: title.trim(),
        description: body,
        ...(stateId === null ? {} : { stateId }),
        priority,
        assigneeId,
        projectId,
        cycleId,
        estimate,
        labelIds,
      },
      {
        onSuccess: (issue) => {
          setPending((current) => current.filter((entry) => !held.includes(entry)));
          finalize(issue, body, held);
          if (!createMore) {
            onOpenChange(false);
            return;
          }
          setTitle('');
          setDescription('');
          setLabelIds([]);
          setComposerKey((value) => value + 1);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="quick-create" className="max-w-xl">
        <DialogTitle className="sr-only">Create issue</DialogTitle>
        <p
          className="flex items-center gap-1.5 text-2xs text-faint"
          data-testid="quick-create-crumb"
        >
          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-text">
            {teams.find((team) => team.id === teamId)?.key ?? 'Team'}
          </span>
          <ChevronRight className="size-3" aria-hidden="true" />
          New issue
        </p>
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
            className="h-9 border-0 px-0 font-medium text-base shadow-none"
          />
          <RichTextEditor
            key={composerKey}
            value={description}
            onChange={setDescription}
            members={members}
            placeholder="Add a description, markdown works."
            ariaLabel="Issue description"
            testId="quick-create-description"
            onUpload={hold}
          />
          {pending.length === 0 ? null : (
            <output className="text-2xs text-faint" data-testid="quick-create-pending">
              {pendingLabel(pending.length)}
            </output>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <PropertyMenu
              title="Team"
              options={teams.map((team) => ({ id: team.id, label: team.name }))}
              selected={teamId === null ? [] : [teamId]}
              onSelect={(id) => {
                setTeamId(id);
                setStateId(null);
                setProjectId(null);
                setEstimate(null);
                setCycleId(null);
                setLabelIds([]);
              }}
            >
              <button type="button" className={chipClassName} data-testid="quick-create-team">
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

            <ScopePickers
              teamProjects={teamProjects}
              teamCycles={teamCycles}
              projectId={projectId}
              estimate={estimate}
              cycleId={cycleId}
              onProject={setProjectId}
              onEstimate={setEstimate}
              onCycle={setCycleId}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-border border-t pt-3">
            <span className="mr-auto flex items-center gap-1 text-2xs text-faint">
              <Kbd keys={['mod', 'enter']} /> to create
            </span>
            <span className="flex items-center gap-2 text-2xs text-muted">
              <Switch
                checked={createMore}
                onCheckedChange={setCreateMore}
                aria-label="Create more"
                data-testid="quick-create-more"
              />
              Create more
            </span>
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
