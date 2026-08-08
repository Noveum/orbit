'use client';

import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/query/fetcher.ts';
import { useDocGateway, useRequestDocAccess } from '@/lib/query/use-doc-access.ts';

export function DocGateway({ docId }: { readonly docId: string }) {
  const gateway = useDocGateway(docId, true);
  const request = useRequestDocAccess(docId);
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [asked, setAsked] = useState(false);

  if (gateway.isPending) {
    return (
      <EmptyState
        icon={<Lock strokeWidth={1.75} aria-hidden="true" />}
        title="Checking your access"
        description="One moment."
        className="flex-1"
      />
    );
  }

  if (gateway.data === undefined) {
    return (
      <EmptyState
        icon={<Lock strokeWidth={1.75} aria-hidden="true" />}
        title="Doc not found"
        description="It may have been deleted, or it belongs to another workspace."
        className="flex-1"
      />
    );
  }

  const waiting = asked || gateway.data.requested;

  return (
    <div
      data-testid="doc-gateway"
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-faint">
        <Lock className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">{gateway.data.title}</h1>
        <p className="text-dense text-muted">
          {gateway.data.ownerName} owns this doc and has not shared it with you yet.
        </p>
      </div>

      {waiting ? (
        <p
          data-testid="doc-gateway-waiting"
          className="flex items-center gap-1.5 text-dense text-success"
        >
          <Check className="size-4" aria-hidden="true" />
          Asked. You will hear back in your inbox.
        </p>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <Textarea
            value={message}
            aria-label="Why you need access"
            data-testid="doc-gateway-message"
            placeholder={`Tell ${gateway.data.ownerName} why you need it (optional)`}
            rows={2}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            data-testid="doc-gateway-request"
            disabled={request.isPending}
            onClick={() => {
              request.mutate(message.trim(), {
                onSuccess: () => setAsked(true),
                onError: (error) =>
                  toast({
                    title: 'Could not ask for access',
                    description: messageOf(error),
                    tone: 'danger',
                  }),
              });
            }}
          >
            Request access
          </Button>
        </div>
      )}
    </div>
  );
}
