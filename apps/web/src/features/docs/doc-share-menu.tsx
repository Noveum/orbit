'use client';

import type { DocVisibility } from '@orbit/shared/constants';
import { isExternallyShared, isRestricted } from '@orbit/shared/constants';
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
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { publicDocUrl } from '@/lib/docs/paths.ts';
import { publicAppUrl } from '@/lib/env.ts';
import type { Doc } from '@/lib/query/schemas.ts';
import { useShareDoc } from '@/lib/query/use-docs.ts';
import { DocPeopleAccess } from './doc-people-access.tsx';

export const VISIBILITY_OPTIONS = [
  {
    value: 'private',
    label: 'Only people you invite',
    trigger: 'Private',
    icon: Lock,
    description: 'Nobody can open it unless you share it with them by name.',
  },
  {
    value: 'team',
    label: 'People you invite, and their team',
    trigger: 'Restricted',
    icon: Users,
    description: 'Shared with the people and teams you name below, and nobody else.',
  },
  {
    value: 'workspace',
    label: 'Workspace only',
    trigger: 'Publish',
    icon: Lock,
    description: 'Nobody outside this workspace can open it.',
  },
  {
    value: 'link',
    label: 'Anyone with the link',
    trigger: 'Unlisted',
    icon: Link2,
    description: 'Unlisted: no search engines, no sitemap, and you can reset the link.',
  },
  {
    value: 'public',
    label: 'Public on the web',
    trigger: 'Public',
    icon: Globe,
    description: 'Indexed by search engines, listed in the sitemap, with a link preview card.',
  },
] as const;

export interface VisibilitySegment {
  readonly value: DocVisibility;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const VISIBILITY_SEGMENTS: readonly VisibilitySegment[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you and the people you invite by name.',
    icon: Lock,
  },
  {
    value: 'workspace',
    label: 'Workspace',
    description: 'Everyone in this workspace can read it.',
    icon: Building2,
  },
  {
    value: 'link',
    label: 'Link',
    description: 'Anyone with the link, unlisted and resettable.',
    icon: Link2,
  },
];

export function visibilityOption(visibility: string) {
  return VISIBILITY_OPTIONS.find((option) => option.value === visibility) ?? VISIBILITY_OPTIONS[0];
}

export function visibleSegments(canPublish: boolean): readonly VisibilitySegment[] {
  return VISIBILITY_SEGMENTS.filter((segment) => canPublish || !isExternallyShared(segment.value));
}

export interface DocShareMenuProps {
  readonly doc: Doc;
  readonly canManageAccess?: boolean;
  readonly canPublish?: boolean;
}

function VisibilitySegments({
  visibility,
  canPublish,
  disabled,
  onSelect,
}: {
  readonly visibility: string;
  readonly canPublish: boolean;
  readonly disabled: boolean;
  readonly onSelect: (value: DocVisibility) => void;
}) {
  return (
    <fieldset
      aria-label="Who can see this doc"
      data-testid="doc-visibility-control"
      className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5"
    >
      {visibleSegments(canPublish).map((segment) => {
        const active = visibility === segment.value;
        return (
          <Tooltip key={segment.value} label={segment.description} side="bottom">
            <button
              type="button"
              aria-label={segment.label}
              aria-pressed={active}
              disabled={disabled}
              data-testid={`doc-visibility-segment-${segment.value}`}
              onClick={() => onSelect(segment.value)}
              className={cn(
                'flex h-6 cursor-pointer items-center gap-1.5 rounded-sm border px-2 font-medium text-2xs',
                'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
                'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
                active
                  ? 'border-border bg-accent-soft text-accent'
                  : 'border-transparent text-faint hover:text-text',
              )}
            >
              <segment.icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{segment.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </fieldset>
  );
}

export function DocShareMenu({
  doc,
  canManageAccess = false,
  canPublish = false,
}: DocShareMenuProps) {
  const share = useShareDoc(doc.id);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);

  const current = visibilityOption(doc.visibility);
  const origin = typeof window === 'undefined' ? publicAppUrl() : window.location.origin;
  const url = publicDocUrl(doc, origin);

  const copy = async () => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Could not copy', description: url, tone: 'danger' });
    }
  };

  return (
    <>
      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Share this doc</DialogTitle>
          <DocPeopleAccess docId={doc.id} canManage={canManageAccess} />
        </DialogContent>
      </Dialog>

      <VisibilitySegments
        visibility={doc.visibility}
        canPublish={canPublish}
        disabled={share.isPending}
        onSelect={(value) => share.mutate({ visibility: value })}
      />

      {url === null ? null : (
        <Tooltip label="Copy the share link" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Copy the share link"
            data-testid="doc-share-copy"
            className="size-7 px-0"
            onClick={() => copy().catch(() => undefined)}
          >
            {copied ? (
              <Check className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={doc.visibility === 'workspace' ? 'secondary' : 'primary'}
            size="sm"
            data-testid="doc-publish"
            disabled={share.isPending}
          >
            <current.icon className="size-3.5" aria-hidden="true" />
            {current.trigger}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Who can see this doc</DropdownMenuLabel>
          {VISIBILITY_OPTIONS.filter(
            (option) => canPublish || !isExternallyShared(option.value),
          ).map((option) => (
            <DropdownMenuItem
              key={option.value}
              data-testid={`doc-visibility-${option.value}`}
              className="items-start"
              onSelect={() => share.mutate({ visibility: option.value })}
            >
              <option.icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-2xs text-faint">{option.description}</span>
              </span>
              {doc.visibility === option.value ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}

          {isRestricted(doc.visibility) ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="doc-open-people" onSelect={() => setPeopleOpen(true)}>
                <Users className="size-3.5" aria-hidden="true" />
                Share with people and teams
              </DropdownMenuItem>
            </>
          ) : null}

          {url === null ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(event) => event.preventDefault()} asChild>
                <button
                  type="button"
                  data-testid="doc-copy-link"
                  onClick={() => copy().catch(() => undefined)}
                  className="w-full"
                >
                  {copied ? (
                    <Check className="size-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-2xs">
                    {url}
                  </span>
                </button>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="doc-rotate-link"
                onSelect={() => share.mutate({ visibility: doc.visibility, rotateToken: true })}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span>Reset the link</span>
                  <span className="text-2xs text-faint">The current link stops working.</span>
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
