'use client';

import { Check, Copy, Globe, Link2, Lock } from 'lucide-react';
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

const OPTIONS = [
  { value: 'workspace', label: 'Workspace only', icon: Lock },
  { value: 'link', label: 'Anyone with the link', icon: Link2 },
  { value: 'public', label: 'Public on the web', icon: Globe },
] as const;

export interface DocShareMenuProps {
  readonly doc: Doc;
}

export function DocShareMenu({ doc }: DocShareMenuProps) {
  const share = useShareDoc(doc.id);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const published = doc.visibility !== 'workspace' && doc.publishToken !== null;
  const url =
    doc.publishToken === null
      ? null
      : new URL(publicDocPath(doc.publishToken), window.location.origin).toString();

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="doc-share">
            Share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Who can see this doc</DropdownMenuLabel>
          {OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              data-testid={`doc-visibility-${option.value}`}
              onSelect={() => share.mutate(option.value)}
            >
              <option.icon className="size-3.5" aria-hidden="true" />
              <span className="flex-1">{option.label}</span>
              {doc.visibility === option.value ? (
                <Check className="size-3.5 text-accent" aria-hidden="true" />
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
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-2xs">
                    {url}
                  </span>
                </button>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="secondary"
        size="sm"
        data-testid="doc-publish"
        disabled={share.isPending}
        onClick={() => share.mutate(published ? 'workspace' : 'public')}
      >
        {published ? 'Unpublish' : 'Publish'}
      </Button>
    </>
  );
}
