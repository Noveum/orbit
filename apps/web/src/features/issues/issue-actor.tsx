import type { IssueActor } from '@orbit/shared/validators';
import { Bot } from 'lucide-react';
import { Avatar, type AvatarProps } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';

export function issueActorLabel(actor: IssueActor): string {
  return `${actor.name}${actor.type === 'agent' ? ' (Agent)' : ''}${actor.deleted ? ' (Deleted)' : ''}`;
}

export function IssueActorDisplay({
  actor,
  size = 'xs',
  showName = false,
}: {
  readonly actor: IssueActor | null;
  readonly size?: AvatarProps['size'];
  readonly showName?: boolean;
}) {
  if (actor === null) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        className={cn(
          'block shrink-0 rounded-full border border-border border-dashed',
          size === 'sm' ? 'size-5.5' : 'size-4.5',
        )}
      />
    );
  }
  return (
    <span
      title={issueActorLabel(actor)}
      data-actor-type={actor.type}
      data-actor-deleted={actor.deleted ? 'true' : undefined}
      className="inline-flex min-w-0 items-center gap-1.5"
    >
      <span className="relative inline-flex shrink-0" aria-hidden={showName || undefined}>
        <Avatar
          name={`${actor.name}${actor.deleted ? ' (Deleted)' : ''}`}
          src={actor.avatar}
          size={size}
        />
        {actor.type === 'agent' ? (
          <Bot
            aria-label={showName ? undefined : 'Agent'}
            aria-hidden={showName || undefined}
            className="-right-1 -bottom-0.5 absolute size-2.5 rounded-sm bg-surface text-muted"
          />
        ) : null}
      </span>
      {showName ? (
        <>
          <span className="truncate">{actor.name}</span>
          {actor.type === 'agent' ? <span className="text-2xs text-muted">Agent</span> : null}
          {actor.deleted ? <span className="text-2xs text-faint">Deleted</span> : null}
        </>
      ) : null}
    </span>
  );
}
