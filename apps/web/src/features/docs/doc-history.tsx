'use client';

import { relativeTime } from '@orbit/shared/utils';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import type { DocVersion } from '@/lib/query/schemas.ts';
import { useDocVersions, useRestoreDocVersion } from '@/lib/query/use-docs.ts';

export interface DocHistoryProps {
  readonly docId: string;
  readonly canWrite: boolean;
}

export function DocHistory({ docId, canWrite }: DocHistoryProps) {
  const [open, setOpen] = useState(false);
  const versions = useDocVersions(docId, open);
  const restore = useRestoreDocVersion(docId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Version history" className="size-7 px-0">
          <History className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="doc-history">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription className="text-2xs text-faint">
            Restoring a version saves it as a new version, so nothing is lost.
          </DialogDescription>
        </DialogHeader>

        <VersionList
          pending={versions.isPending}
          versions={versions.data ?? []}
          canWrite={canWrite}
          restoring={restore.isPending}
          onRestore={(versionId) => restore.mutate(versionId)}
        />
      </DialogContent>
    </Dialog>
  );
}

function VersionList({
  pending,
  versions,
  canWrite,
  restoring,
  onRestore,
}: {
  readonly pending: boolean;
  readonly versions: readonly DocVersion[];
  readonly canWrite: boolean;
  readonly restoring: boolean;
  readonly onRestore: (versionId: string) => void;
}) {
  if (pending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (versions.length === 0) {
    return <p className="text-dense text-faint">No saved versions yet.</p>;
  }

  return (
    <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
      {versions.map((version, index) => (
        <li
          key={version.id}
          data-testid={`doc-version-${version.id}`}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-dense text-text">{version.title}</span>
            <span className="block text-2xs text-faint">
              {relativeTime(new Date(version.lastSavedAt))}
              {version.restoredFromId === null ? '' : ' · restored'}
            </span>
          </span>
          {index === 0 ? <span className="text-2xs text-faint">Current</span> : null}
          {index > 0 && canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              data-testid={`restore-${version.id}`}
              disabled={restoring}
              onClick={() => onRestore(version.id)}
            >
              Restore
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
