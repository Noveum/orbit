'use client';

import type { ViewVisibility } from '@orbit/shared/filters';
import { conditionsOf, VIEW_VISIBILITIES, VIEW_VISIBILITY_LABELS } from '@orbit/shared/filters';
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
import type { ViewConfig, ViewLayoutMode } from './view-config.ts';
import { viewConfigToState } from './view-config.ts';

export interface SaveViewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly config: ViewConfig;
  readonly layout: ViewLayoutMode;
  readonly teamId: string | null;
  readonly suggestedName: string;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  config,
  layout,
  teamId,
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

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        name: trimmed,
        filter: viewConfigToState(
          config,
          layout,
          { teamId, projectId: null },
          { visibility, locked },
        ),
        layout,
        groupBy: config.groupBy,
        shared: visibility !== 'private',
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
            {VIEW_VISIBILITIES.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 text-dense text-muted"
                htmlFor={`save-view-visibility-${option}`}
              >
                <input
                  type="radio"
                  id={`save-view-visibility-${option}`}
                  name="save-view-visibility"
                  value={option}
                  checked={visibility === option}
                  data-testid={`save-view-visibility-${option}`}
                  onChange={() => setVisibility(option)}
                  className="accent-[var(--color-accent)]"
                />
                {VIEW_VISIBILITY_LABELS[option]}
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
