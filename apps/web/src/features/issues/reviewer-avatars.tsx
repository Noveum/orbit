'use client';

import { Avatar } from '@/components/ui/avatar.tsx';
import type { Member } from '@/lib/query/schemas.ts';

export function ReviewerAvatars({
  reviewers,
  size = 'xs',
}: {
  readonly reviewers: readonly Member[];
  readonly size?: 'xs' | 'sm';
}) {
  if (reviewers.length === 0) return null;
  const names = reviewers.map((reviewer) => reviewer.name).join(', ');
  return (
    <span
      className="flex items-center -space-x-1"
      title={`Reviewers: ${names}`}
      data-testid="reviewer-avatars"
    >
      {reviewers.slice(0, 3).map((reviewer) => (
        <Avatar
          key={reviewer.id}
          name={reviewer.name}
          src={reviewer.image}
          size={size}
          className="ring-1 ring-surface"
        />
      ))}
      {reviewers.length > 3 ? (
        <span className="relative inline-flex size-4.5 items-center justify-center rounded-full border border-border bg-surface-2 text-[9px] text-muted ring-1 ring-surface">
          +{reviewers.length - 3}
        </span>
      ) : null}
    </span>
  );
}
