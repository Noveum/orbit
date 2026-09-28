'use client';

import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useIssueRelations } from '@/lib/query/use-relations.ts';

export interface DuplicateBannerProps {
  readonly issueId: string;
}

export function DuplicateBanner({ issueId }: DuplicateBannerProps) {
  const relations = useIssueRelations(issueId);
  const duplicateOf = relations.data?.find((entry) => entry.type === 'duplicate_of');

  if (duplicateOf === undefined) return null;

  const survivor = duplicateOf.issue;

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-dense text-text"
      data-testid="duplicate-banner"
    >
      <Copy className="size-4 text-amber-500 shrink-0" aria-hidden="true" />
      <span>
        This issue was marked as a duplicate of{' '}
        <Link
          href={`/issue/${encodeURIComponent(survivor.identifier)}`}
          className="font-medium text-primary hover:underline"
          data-testid="duplicate-survivor-link"
        >
          {survivor.identifier}: {survivor.title}
        </Link>
        .
      </span>
    </div>
  );
}
