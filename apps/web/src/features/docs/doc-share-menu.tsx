'use client';

import type { DocVisibility } from '@orbit/shared/constants';
import { isPublished } from '@orbit/shared/constants';
import {
  Building2,
  Check,
  Copy,
  Globe,
  Link2,
  Lock,
  type LucideIcon,
  RefreshCw,
  Users,
} from 'lucide-react';
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
    label: 'Private: invited people and teams',
    description: 'Only you and the people or teams you add below can open this page.',
    icon: Lock,
  },
  {
    value: 'workspace',
    label: 'Everyone in this workspace',
    description: 'Workspace members can edit. Guests and contributors can view.',
    icon: Building2,
  },
  {
    value: 'members',
    label: 'Anyone in this workspace with the link',
    description:
      'A read-only page for signed-in workspace members. Also visible in workspace docs.',
    icon: Users,
  },
  {
    value: 'link',
    label: 'Anyone with the link',
    description:
      'Anyone with this URL can view. Also visible in workspace docs. Search engines are blocked.',
    icon: Link2,
  },
  {
    value: 'public',
    label: 'Public on the web',
    description: 'Anyone can view. Search engines may index this page.',
    icon: Globe,
  },
];

export function visibilityChoice(visibility: string): VisibilityChoice {
  return (
    VISIBILITY_CHOICES.find(
      (choice) => choice.value === (visibility === 'team' ? 'private' : visibility),
    ) ?? (VISIBILITY_CHOICES[0] as VisibilityChoice)
  );
}

export function visibleChoices(canPublish: boolean): readonly VisibilityChoice[] {
  return VISIBILITY_CHOICES.filter((choice) => canPublish || !isPublished(choice.value));
}

export function shareTrigger(visibility: string): string {
  if (visibility === 'public') return 'Public';
  if (visibility === 'link') return 'Unlisted';
  if (visibility === 'members') return 'Members';
  if (visibility === 'workspace') return 'Workspace';
  return 'Private';
}

export function publishedLinkLabel(visibility: string): string {
  return visibility === 'members' ? 'Members link' : 'Public link';
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
  const publishedUrl = publicDocUrl(doc, origin);

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
            {visibleChoices(canPublish || isPublished(doc.visibility)).map((choice) => {
              const active = current.value === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={active}
                  disabled={!canManageAccess || share.isPending}
                  data-testid={`doc-visibility-${choice.value}`}
                  onClick={() => share.mutate({ visibility: choice.value })}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-2 py-1.5 text-left',
                    'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                    'disabled:cursor-default',
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

          <CopyRow label="Workspace link" url={workspaceUrl} testId="doc-copy-link" />

          {publishedUrl === null ? null : (
            <div className="flex flex-col gap-2">
              <CopyRow
                label={publishedLinkLabel(doc.visibility)}
                url={publishedUrl}
                testId="doc-copy-public-link"
              />
              <Button
                variant="ghost"
                size="sm"
                data-testid="doc-rotate-link"
                disabled={!canManageAccess || share.isPending}
                className="self-start"
                onClick={() => share.mutate({ visibility: doc.visibility, rotateToken: true })}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {doc.visibility === 'members' ? 'Reset the members link' : 'Reset the public link'}
              </Button>
            </div>
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
