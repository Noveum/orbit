'use client';

import type { DocVisibility } from '@orbit/shared/constants';
import { isPublished, isRestricted } from '@orbit/shared/constants';
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
    label: 'Only people you invite',
    description: 'Nobody can open it unless you share it with them by name.',
    icon: Lock,
  },
  {
    value: 'team',
    label: 'People you invite, and their team',
    description: 'Shared with the people and teams you name below, and nobody else.',
    icon: Lock,
  },
  {
    value: 'workspace',
    label: 'Everyone in this workspace',
    description: 'Anyone signed in to this workspace can read it. Nobody outside can.',
    icon: Building2,
  },
  {
    value: 'members',
    label: 'Anyone in this workspace with the link',
    description:
      'A published URL. Signed-in workspace members can open it. Nobody outside can, and it stays out of search.',
    icon: Users,
  },
  {
    value: 'link',
    label: 'Anyone with the link',
    description: 'Unlisted: no search engines, no sitemap, and you can reset the link.',
    icon: Link2,
  },
  {
    value: 'public',
    label: 'Public on the web',
    description: 'Indexed by search engines, listed in the sitemap, with a link preview card.',
    icon: Globe,
  },
];

export function visibilityChoice(visibility: string): VisibilityChoice {
  return (
    VISIBILITY_CHOICES.find((choice) => choice.value === visibility) ??
    (VISIBILITY_CHOICES[0] as VisibilityChoice)
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
          {shareTrigger(doc.visibility)}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogTitle>Share this doc</DialogTitle>

        <div className="flex flex-col gap-4">
          <fieldset
            aria-label="Who can see this doc"
            data-testid="doc-visibility-control"
            className="flex flex-col gap-0.5"
          >
            {visibleChoices(canPublish).map((choice) => {
              const active = doc.visibility === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={active}
                  disabled={share.isPending}
                  data-testid={`doc-visibility-${choice.value}`}
                  onClick={() => share.mutate({ visibility: choice.value })}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-2 py-1.5 text-left',
                    'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                    'disabled:cursor-not-allowed disabled:opacity-50',
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
                className="self-start"
                onClick={() => share.mutate({ visibility: doc.visibility, rotateToken: true })}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {doc.visibility === 'members' ? 'Reset the members link' : 'Reset the public link'}
              </Button>
            </div>
          )}

          {isRestricted(doc.visibility) ? (
            <div className="flex flex-col gap-3 border-border border-t pt-3">
              <DocPeopleAccess docId={doc.id} canManage={canManageAccess} />
              {canManageAccess ? <DocAccessRequests docId={doc.id} /> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
