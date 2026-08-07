'use client';

import type { ViewVisibility } from '@orbit/shared/filters';
import { conditionsOf } from '@orbit/shared/filters';
import { useEffect, useState } from 'react';
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
import { Switch } from '@/components/ui/switch.tsx';
import { useCreateView } from '@/lib/query/use-views.ts';
import type { ViewConfig, ViewLayoutMode, ViewScope } from './view-config.ts';
import { viewConfigToState } from './view-config.ts';
import { allowedVisibility, visibilityChoices } from './view-visibility.ts';

export interface SaveViewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly config: ViewConfig;
  readonly layout: ViewLayoutMode;
  readonly scope: ViewScope;
  readonly teamName: string;
  readonly suggestedName: string;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  config,
  layout,
  scope,
  teamName,
  suggestedName,
}: SaveViewDialogProps) {
  const create = useCreateView();
  const [name, setName] = useState(suggestedName);
  const [visibility, setVisibility] = useState<ViewVisibility>('private');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (open) setName(suggestedName);
  }, [open, suggestedName]);

  const count = conditionsOf(config.filter).length;
  const team = scope.teamId === null ? null : { id: scope.teamId, name: teamName };
  const choices = visibilityChoices(team);
  const chosen = allowedVisibility(visibility, team);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        name: trimmed,
        filter: viewConfigToState(config, layout, scope, { visibility: chosen, locked }),
        layout,
        groupBy: config.groupBy,
        shared: chosen !== 'private',
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="save-view-dialog">
        <DialogHeader>
          <DialogTitle className="font-medium text-base text-text">Save this view</DialogTitle>
          <DialogDescription className="text-muted text-xs">
            {count === 0
              ? 'No filters yet, the layout and grouping are still saved.'
              : `${count} filter${count === 1 ? '' : 's'} and the current display options.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor="save-view-name">
            Name
            <Input
              id="save-view-name"
              autoFocus
              value={name}
              maxLength={120}
              data-testid="save-view-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="High priority bugs"
            />
          </label>

          <fieldset className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-2">
            <legend className="px-1 text-2xs text-faint">Visibility</legend>
            {choices.map((choice) => (
              <label
                key={choice.value}
                className="flex items-center gap-2 text-dense text-muted"
                htmlFor={`save-view-visibility-${choice.value}`}
              >
                <input
                  type="radio"
                  id={`save-view-visibility-${choice.value}`}
                  name="save-view-visibility"
                  value={choice.value}
                  checked={chosen === choice.value}
                  data-testid={`save-view-visibility-${choice.value}`}
                  onChange={() => setVisibility(choice.value)}
                  className="accent-[var(--color-accent)]"
                />
                {choice.label}
              </label>
            ))}
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <label htmlFor="save-view-locked" className="text-dense text-muted">
              Lock so it cannot be changed
            </label>
            <Switch
              id="save-view-locked"
              checked={locked}
              onCheckedChange={setLocked}
              data-testid="save-view-locked"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={name.trim().length === 0 || create.isPending}
              data-testid="save-view-submit"
            >
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
