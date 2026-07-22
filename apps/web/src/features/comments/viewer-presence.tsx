'use client';

import { usePresence } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import { useEffect } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';

const HEARTBEAT_MS = 20_000;

export interface ViewerPresenceProps {
  readonly issueId: string;
}

export function ViewerPresence({ issueId }: ViewerPresenceProps) {
  const { others, setPresence } = usePresence(scopes.issue(issueId));

  useEffect(() => {
    setPresence('viewing');
    const timer = setInterval(() => setPresence('viewing'), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [setPresence]);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-1" data-testid="viewer-presence">
      <span className="text-2xs text-faint">Viewing</span>
      <div className="flex -space-x-1.5">
        {others.slice(0, 5).map((viewer) => (
          <Tooltip key={viewer.userId} label={viewer.name} side="bottom">
            <span className="rounded-full ring-2 ring-bg">
              <Avatar name={viewer.name} src={viewer.image} size="xs" />
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
