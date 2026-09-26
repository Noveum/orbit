'use client';

import { Avatar } from '@/components/ui/avatar.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import type { Activity } from '@/lib/query/schemas.ts';

export function ActivityEntry({ entry }: { entry: Activity }) {
  return (
    <li className="flex items-center gap-2 text-2xs text-faint">
      <Avatar name={entry.actorName} src={entry.actorAvatar} size="xs" />
      <span className="font-medium text-muted" data-testid="activity-actor">
        {entry.actorName}
      </span>
      {entry.actorType === 'agent' ? (
        <span
          className="rounded-sm bg-surface-2 px-1 text-2xs text-faint"
          data-testid="activity-agent-badge"
        >
          {entry.principalName === null ? 'agent' : `agent for ${entry.principalName}`}
        </span>
      ) : null}
      <span>{entry.summary}</span>
      <span className="ml-auto">
        <RelativeTime at={entry.createdAt} />
      </span>
    </li>
  );
}
