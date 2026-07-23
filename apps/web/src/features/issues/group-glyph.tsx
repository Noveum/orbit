'use client';

import type { IssueGroup } from '@/features/filters/grouping.ts';
import { StateGlyph } from './state-glyph.tsx';

export function GroupGlyph({ group }: { group: Pick<IssueGroup, 'category' | 'color' | 'title'> }) {
  if (group.category !== null && group.color !== null) {
    return <StateGlyph category={group.category} color={group.color} title={group.title} />;
  }
  if (group.color !== null) {
    return (
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: group.color }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="size-2.5 shrink-0 rounded-full border border-border" aria-hidden="true" />
  );
}
