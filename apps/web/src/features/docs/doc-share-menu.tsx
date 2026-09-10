'use client';

import type { DocVisibility } from '@orbit/shared/constants';
import { isExternallyShared } from '@orbit/shared/constants';
import { Building2, Check, Copy, Link2, Lock, type LucideIcon, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { cn } from '@/lib/cn.ts';
import { appDocUrl, publicDocUrl } from '@/lib/docs/paths.ts';
import { publicAppUrl } from '@/lib/env.ts';
import type { Doc } from '@/lib/query/schemas.ts';
import { useShareDoc } from '@/lib/query/use-docs.ts';
import { DocAccessRequests } from './doc-access-requests.tsx';
import { DocPeopleAccess } from './doc-people-access.tsx';

export interface VisibilityChoice {
  readonly value: DocVisibility;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const VISIBILITY_CHOICES: readonly VisibilityChoice[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you and invited people or teams.',
    icon: Lock,
  },
  {
    value: 'workspace',
    label: 'Workspace',
    description: 'Everyone in this workspace. Sign-in required.',
    icon: Building2,
  },
  {
    value: 'link',
    label: 'Anyone with the link',
    description: 'Anyone can view without signing in.',
    icon: Link2,
  },
];

export function visibilityChoice(visibility: string): VisibilityChoice {
  let audience = visibility;
  if (visibility === 'team') audience = 'private';
  if (visibility === 'members') audience = 'workspace';
  if (visibility === 'public') audience = 'link';
  return (
    VISIBILITY_CHOICES.find((choice) => choice.value === audience) ??
    (VISIBILITY_CHOICES[0] as VisibilityChoice)
  );
}

export function visibleChoices(canPublish: boolean): readonly VisibilityChoice[] {
  return VISIBILITY_CHOICES.filter((choice) => canPublish || !isExternallyShared(choice.value));
}

export function shareTrigger(visibility: string): string {
  return visibilityChoice(visibility).label;
}

function CopyRow({
  label,
  url,
  testId,
}: {
  readonly label: string;
  readonly url: string;
  readonly testId: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast({ title: 'Could not copy', description: url, tone: 'danger' }));
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-2xs text-faint">{label}</span>
        <span
          data-testid={`${testId}-url`}
          className="block truncate font-mono text-2xs text-muted"
        >
          {url}
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Copy ${label.toLowerCase()}`}
        data-testid={testId}
        onClick={copy}
      >
        {copied ? (
          <Check className="size-3.5 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export interface DocShareMenuProps {
  readonly doc: Doc;
  readonly canManageAccess?: boolean;
  readonly canPublish?: boolean;
}

export function DocShareMenu({
  doc,
  canManageAccess = false,
  canPublish = false,
}: DocShareMenuProps) {
  const share = useShareDoc(doc.id);
  const [open, setOpen] = useState(false);

  const current = visibilityChoice(doc.visibility);
  const origin = typeof window === 'undefined' ? publicAppUrl() : window.location.origin;
  const workspaceUrl = appDocUrl(doc.id, origin);
  const external = isExternallyShared(doc.visibility);
  const publishedUrl = external ? publicDocUrl(doc, origin) : null;
  const disabled = !canManageAccess || share.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="doc-share">
          <current.icon className="size-3.5" aria-hidden="true" />
          Share
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogTitle>Share “{doc.title}”</DialogTitle>

        <div className="flex flex-col gap-4">
          <fieldset
            aria-label="Who can see this doc"
            data-testid="doc-visibility-control"
            className="flex flex-col gap-1 rounded-lg border border-border p-2"
          >
            {visibleChoices(canPublish || isExternallyShared(doc.visibility)).map((choice) => {
              const active = current.value === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={active}
                  disabled={
                    !canManageAccess ||
                    share.isPending ||
                    (isExternallyShared(choice.value) && !canPublish)
                  }
                  data-testid={`doc-visibility-${choice.value}`}
                  onClick={() => {
                    if (active) return;
                    share.mutate({ visibility: choice.value });
                  }}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-2 py-1.5 text-left',
                    'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                    active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <choice.icon
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      active ? 'text-accent' : 'text-faint',
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn('text-dense', active ? 'text-accent' : 'text-text')}>
                      {choice.label}
                    </span>
                    <span className="text-2xs text-faint">{choice.description}</span>
                  </span>
                  {active ? (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </fieldset>

          <p className="text-2xs text-muted">
            {canManageAccess
              ? 'Choose who can open this page. Folder location never changes access.'
              : 'Only the author can change sharing. Copying a link does not grant access.'}
          </p>

          {current.value === 'workspace' ? (
            <label className="flex items-center justify-between gap-3 text-dense">
              Workspace access
              <select
                aria-label="Workspace access"
                className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-dense"
                value={doc.visibility === 'members' ? 'members' : 'workspace'}
                disabled={disabled}
                onChange={(event) =>
                  share.mutate({ visibility: event.target.value as DocVisibility })
                }
              >
                <option value="members">Can view</option>
                <option value="workspace">Can edit</option>
              </select>
            </label>
          ) : null}

          {external ? (
            <label className="flex items-center gap-2 text-dense">
              <input
                type="checkbox"
                checked={doc.visibility === 'public'}
                disabled={disabled || !canPublish}
                onChange={(event) =>
                  share.mutate({ visibility: event.target.checked ? 'public' : 'link' })
                }
              />
              Allow search engines to find this page
            </label>
          ) : null}

          <CopyRow
            label={external ? 'Public link' : 'Document link'}
            url={publishedUrl ?? workspaceUrl}
            testId="doc-copy-link"
          />

          {publishedUrl === null ? null : (
            <Button
              variant="ghost"
              size="sm"
              data-testid="doc-rotate-link"
              disabled={disabled || !canPublish}
              className="self-start"
              onClick={() => share.mutate({ visibility: doc.visibility, rotateToken: true })}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reset public link
            </Button>
          )}

          {
            <div className="flex flex-col gap-3 border-border border-t pt-3">
              <DocPeopleAccess docId={doc.id} canManage={canManageAccess} />
              {canManageAccess ? <DocAccessRequests docId={doc.id} /> : null}
            </div>
          }
        </div>
      </DialogContent>
    </Dialog>
  );
}
