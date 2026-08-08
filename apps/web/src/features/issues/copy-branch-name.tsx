'use client';

import { branchName } from '@orbit/shared/utils';
import { GitBranch } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { useWorkspace } from './workspace-provider.tsx';

type BranchCopySource = {
  readonly ready: boolean;
  readonly userId: string | null;
  readonly memberById: ReadonlyMap<string, { readonly handle: string | null }>;
};

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

export function branchCopy(
  workspace: BranchCopySource,
  issue: Pick<Issue, 'identifier' | 'title'>,
): { readonly branch: string; readonly ready: boolean } {
  const handle =
    workspace.userId === null ? null : (workspace.memberById.get(workspace.userId)?.handle ?? null);
  return { branch: branchNameFor(issue, handle), ready: workspace.ready };
}

export function CopyBranchNameMenuItem({ issue }: { readonly issue: Issue }) {
  const workspace = useWorkspace();
  const { toast } = useToast();
  const { branch, ready } = branchCopy(workspace, issue);

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
      disabled={!ready}
      onSelect={() => {
        copy().catch(() => undefined);
      }}
    >
      <GitBranch className="size-3.5" aria-hidden="true" />
      Copy branch name
    </DropdownMenuItem>
  );
}
