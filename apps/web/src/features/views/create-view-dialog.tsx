'use client';

import type { ViewPage, ViewVisibility } from '@orbit/shared/filters';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import { LayoutToggle } from '@/features/filters/layout-toggle.tsx';
import type { ViewConfig, ViewLayoutMode, ViewScope } from '@/features/filters/view-config.ts';
import {
  applyCapabilities,
  defaultViewConfig,
  viewConfigToState,
} from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import {
  allowedVisibility,
  audienceTeam,
  visibilityChoices,
} from '@/features/filters/view-visibility.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useCreateView } from '@/lib/query/use-views.ts';

export const WORKSPACE_SCOPE = 'workspace';
const TEAM_PREFIX = 'team:';
const PROJECT_PREFIX = 'project:';

export function teamScopeValue(teamId: string): string {
  return `${TEAM_PREFIX}${teamId}`;
}

export function projectScopeValue(projectId: string): string {
  return `${PROJECT_PREFIX}${projectId}`;
}

export function parseViewScope(value: string): ViewScope {
  if (value.startsWith(TEAM_PREFIX)) {
    return { teamId: value.slice(TEAM_PREFIX.length), projectId: null };
  }
  if (value.startsWith(PROJECT_PREFIX)) {
    return { teamId: null, projectId: value.slice(PROJECT_PREFIX.length) };
  }
  return { teamId: null, projectId: null };
}

export function viewScopePage(value: string): ViewPage {
  if (value.startsWith(PROJECT_PREFIX)) return 'project';
  if (value.startsWith(TEAM_PREFIX)) return 'team';
  return 'saved_view';
}

export interface CreateViewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function CreateViewDialog({ open, onOpenChange }: CreateViewDialogProps) {
  const workspace = useWorkspace();
  const create = useCreateView();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>(WORKSPACE_SCOPE);
  const [layout, setLayout] = useState<ViewLayoutMode>('list');
  const [visibility, setVisibility] = useState<ViewVisibility>('private');
  const [draft, setDraft] = useState<ViewConfig>(() => defaultViewConfig('list'));

  useEffect(() => {
    if (!open) return;
    setName('');
    setScope(WORKSPACE_SCOPE);
    setLayout('list');
    setVisibility('private');
    setDraft(defaultViewConfig('list'));
  }, [open]);

  const page = viewScopePage(scope);
  const config = useMemo(() => applyCapabilities(draft, page, layout), [draft, page, layout]);
  const controls = useProvideViewControls(page, layout, config);
  const target = parseViewScope(scope);
  const scopeLabel = scopeLabelFor(scope, workspace.teams, workspace.projects);
  const team = audienceTeam(workspace.teams, target.teamId);
  const choices = visibilityChoices(team);
  const chosen = allowedVisibility(visibility, team);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        name: trimmed,
        filter: viewConfigToState(config, layout, target, { visibility: chosen }),
        layout,
        groupBy: config.groupBy,
        shared: chosen !== 'private',
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="create-view-dialog">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">New view</DialogTitle>
          <DialogDescription className="text-muted text-xs">
            Pick what it covers, how it is laid out and which issues it keeps. You can change all of
            it later.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor="create-view-name">
              Name
              <Input
                id="create-view-name"
                autoFocus
                value={name}
                maxLength={120}
                data-testid="create-view-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="High priority bugs"
              />
            </label>

            <div className="flex flex-col gap-1.5 text-2xs text-faint">
              <span id="create-view-scope-label">Scope</span>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger
                  aria-labelledby="create-view-scope-label"
                  data-testid="create-view-scope"
                >
                  <SelectValue>{scopeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WORKSPACE_SCOPE}>Everything in the workspace</SelectItem>
                  {workspace.teams.length === 0 ? null : (
                    <SelectGroup>
                      <SelectLabel>Teams</SelectLabel>
                      {workspace.teams.map((team) => (
                        <SelectItem key={team.id} value={teamScopeValue(team.id)}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {workspace.projects.length === 0 ? null : (
                    <SelectGroup>
                      <SelectLabel>Projects</SelectLabel>
                      {workspace.projects.map((project) => (
                        <SelectItem key={project.id} value={projectScopeValue(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-faint">Layout</span>
            <LayoutToggle layout={layout} onChange={setLayout} />
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <FilterBar
              teamId={target.teamId}
              teamName={scopeLabel}
              layout={layout}
              config={config}
              onChange={setDraft}
              controls={controls}
              showSaveView={false}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-2">
            <legend className="px-1 text-2xs text-faint">Who can see it</legend>
            {choices.map((choice) => (
              <label
                key={choice.value}
                className="flex items-center gap-2 text-dense text-muted"
                htmlFor={`create-view-visibility-${choice.value}`}
              >
                <input
                  type="radio"
                  id={`create-view-visibility-${choice.value}`}
                  name="create-view-visibility"
                  value={choice.value}
                  checked={chosen === choice.value}
                  data-testid={`create-view-visibility-${choice.value}`}
                  onChange={() => setVisibility(choice.value)}
                  className="accent-[var(--color-accent)]"
                />
                {choice.label}
              </label>
            ))}
          </fieldset>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={name.trim().length === 0 || create.isPending}
              data-testid="create-view-submit"
            >
              Create view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function scopeLabelFor(
  value: string,
  teams: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
): string {
  const scope = parseViewScope(value);
  const project = projects.find((entry) => entry.id === scope.projectId);
  if (project !== undefined) return project.name;
  const team = teams.find((entry) => entry.id === scope.teamId);
  if (team !== undefined) return team.name;
  return 'Workspace';
}
