'use client';

import { RelativeTime } from '@/components/ui/relative-time.tsx';
import type { Activity } from '@/lib/query/schemas.ts';

export function ActivityEntry({ entry }: { entry: Activity }) {
  return (
    <li className="flex items-baseline gap-2 text-2xs text-faint">
      <span className="font-medium text-muted">{entry.actorName}</span>
      <span>{entry.summary}</span>
      <span className="ml-auto">
        <RelativeTime at={entry.createdAt} />
      </span>
    </li>
  );
}
