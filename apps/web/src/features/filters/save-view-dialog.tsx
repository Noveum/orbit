'use client';

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
import { viewConfigToFilter } from './view-config.ts';

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
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (open) setName(suggestedName);
  }, [open, suggestedName]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        name: trimmed,
        filter: {
          ...viewConfigToFilter(config),
          ...(teamId === null ? {} : { teamId }),
        },
        layout,
        groupBy: config.groupBy,
        shared,
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
            {config.predicates.length === 0
              ? 'No filters yet, the layout and grouping are still saved.'
              : `${config.predicates.length} filter${config.predicates.length === 1 ? '' : 's'} and the current display options.`}
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

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <label htmlFor="save-view-shared" className="text-dense text-muted">
              Share with the workspace
            </label>
            <Switch
              id="save-view-shared"
              checked={shared}
              onCheckedChange={setShared}
              data-testid="save-view-shared"
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
