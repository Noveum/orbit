'use client';

import { branchName } from '@orbit/shared/utils';
import { GitBranch } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { useWorkspace } from './workspace-provider.tsx';

export function branchNameFor(
  issue: Pick<Issue, 'identifier' | 'title'>,
  handle: string | null,
): string {
  return branchName({
    username: handle ?? '',
    identifier: issue.identifier,
    title: issue.title,
  });
}

export function CopyBranchNameMenuItem({ issue }: { readonly issue: Issue }) {
  const workspace = useWorkspace();
  const { toast } = useToast();
  const handle =
    workspace.userId === null ? null : (workspace.memberById.get(workspace.userId)?.handle ?? null);
  const branch = branchNameFor(issue, handle);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(branch);
      toast({ title: 'Branch name copied', description: branch });
    } catch {
      toast({ title: 'Could not copy the branch name', description: branch, tone: 'danger' });
    }
  };

  return (
    <DropdownMenuItem
      data-testid={`copy-branch-name-${issue.identifier}`}
      onSelect={() => {
        copy().catch(() => undefined);
      }}
    >
      <GitBranch className="size-3.5" aria-hidden="true" />
      Copy branch name
    </DropdownMenuItem>
  );
}
