'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

export interface InviteAcceptProps {
  readonly token: string;
  readonly organizationName: string;
}

export function InviteAccept({ token, organizationName }: InviteAcceptProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/invites/${token}/accept`, { method: 'POST' });
      router.push('/my-issues');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" size="md" block onClick={accept} disabled={pending}>
        {pending ? 'Joining' : `Join ${organizationName}`}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
