'use client';

import { Check, Copy, Globe, Link2, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { publicDocPath } from '@/lib/docs/paths.ts';
import type { Doc } from '@/lib/query/schemas.ts';
import { useShareDoc } from '@/lib/query/use-docs.ts';

export const VISIBILITY_OPTIONS = [
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

export function visibilityOption(visibility: string) {
  return VISIBILITY_OPTIONS.find((option) => option.value === visibility) ?? VISIBILITY_OPTIONS[0];
}

export interface DocShareMenuProps {
  readonly doc: Doc;
}

export function DocShareMenu({ doc }: DocShareMenuProps) {
  const share = useShareDoc(doc.id);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const current = visibilityOption(doc.visibility);
  const path = publicDocPath(doc);
  const url = path === null ? null : new URL(path, window.location.origin).toString();

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
        {VISIBILITY_OPTIONS.map((option) => (
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
                <span className="min-w-0 flex-1 truncate text-left font-mono text-2xs">{url}</span>
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
  );
}
