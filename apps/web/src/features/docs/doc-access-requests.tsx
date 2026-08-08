'use client';

import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useDecideDocAccessRequest, useDocAccessRequests } from '@/lib/query/use-doc-access.ts';

export function DocAccessRequests({ docId }: { readonly docId: string }) {
  const workspace = useWorkspace();
  const requests = useDocAccessRequests(docId);
  const decide = useDecideDocAccessRequest(docId);

  const pending = requests.data ?? [];
  if (pending.length === 0) return null;

  return (
    <section data-testid="doc-access-requests" className="flex flex-col gap-1.5">
      <h3 className="font-medium text-2xs text-faint uppercase tracking-wide">
        Waiting on you ({pending.length})
      </h3>
      {pending.map((request) => {
        const person = workspace.members.find((member) => member.id === request.requesterId);
        const name = person?.name ?? 'Someone in this workspace';
        return (
          <div
            key={request.id}
            data-testid={`doc-access-request-${request.id}`}
            className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5"
          >
            <Avatar name={name} src={person?.image ?? null} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-dense text-text">{name}</span>
              {request.message === null || request.message.length === 0 ? null : (
                <span className="text-2xs text-muted">{request.message}</span>
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              data-testid={`doc-access-decline-${request.id}`}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ requestId: request.id, grant: false })}
            >
              Decline
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-testid={`doc-access-grant-${request.id}`}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ requestId: request.id, grant: true })}
            >
              Give access
            </Button>
          </div>
        );
      })}
    </section>
  );
}
