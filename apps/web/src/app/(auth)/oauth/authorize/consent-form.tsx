'use client';

import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { authClient } from '@/lib/auth/client.ts';

const SCOPE_LABELS: Record<string, string> = {
  'orbit.read': 'Read your issues, projects, cycles, docs, and workspace members',
  'orbit.write': 'Create and update issues, comments, projects, and cycles',
  offline_access: 'Stay connected without signing in again',
};

export interface ConsentOrganization {
  readonly id: string;
  readonly name: string;
}

export interface ConsentFormProps {
  readonly consentCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly scope: string;
  readonly scopes: readonly string[];
  readonly organizations: readonly ConsentOrganization[];
  readonly requirePasskey: boolean;
  readonly userEmail: string;
}

type Pending = 'allow' | 'deny' | null;

interface DecisionResponse {
  readonly status?: string;
  readonly redirectUri?: string;
  readonly message?: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Try again.';
}

export function ConsentForm({
  consentCode,
  clientId,
  clientName,
  scope,
  scopes,
  organizations,
  requirePasskey,
  userEmail,
}: ConsentFormProps) {
  const { toast } = useToast();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [pending, setPending] = useState<Pending>(null);

  const permissions = scopes.filter((entry) => SCOPE_LABELS[entry] !== undefined);

  async function post(decision: 'allow' | 'deny'): Promise<DecisionResponse> {
    const response = await fetch('/oauth/authorize/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, consentCode, clientId, scope, organizationId }),
    });
    const data = (await response.json().catch(() => ({}))) as DecisionResponse;
    if (response.status === 200) return data;
    throw new Error(data.message ?? 'Could not complete the connection.');
  }

  async function decide(decision: 'allow' | 'deny', alreadyVerified: boolean): Promise<void> {
    const data = await post(decision);
    if (data.status === 'passkey_required') {
      if (alreadyVerified) throw new Error('Passkey verification did not complete.');
      const result = await authClient.signIn.passkey();
      if (result?.error) throw new Error(result.error.message ?? 'Passkey verification failed.');
      await decide(decision, true);
      return;
    }
    if (typeof data.redirectUri !== 'string') {
      throw new Error(data.message ?? 'Could not complete the connection.');
    }
    window.location.assign(data.redirectUri);
  }

  function run(decision: 'allow' | 'deny'): void {
    if (pending !== null) return;
    setPending(decision);
    decide(decision, false).catch((error: unknown) => {
      toast({ title: 'Could not connect', description: messageOf(error), tone: 'danger' });
      setPending(null);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-center text-muted text-sm">
        <span className="font-medium text-text">{clientName}</span> wants to act in Orbit as{' '}
        <span className="font-medium text-text">{userEmail}</span>.
      </p>

      <label className="flex flex-col gap-1.5 text-2xs text-faint">
        Workspace
        <select
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          disabled={pending !== null}
          className="h-9 rounded-md border border-border bg-surface px-2.5 text-dense text-text"
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </label>

      {permissions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs text-faint">It will be able to</span>
          <ul className="flex flex-col gap-1.5">
            {permissions.map((entry) => (
              <li key={entry} className="flex items-start gap-2 text-dense text-text">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                {SCOPE_LABELS[entry]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          block
          disabled={pending !== null}
          onClick={() => run('deny')}
        >
          Deny
        </Button>
        <Button
          type="button"
          variant="primary"
          block
          disabled={pending !== null || organizationId === ''}
          onClick={() => run('allow')}
        >
          {pending === 'allow' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Approve
        </Button>
      </div>

      {requirePasskey ? (
        <p className="text-center text-2xs text-faint">
          Approving prompts you to verify with your passkey.
        </p>
      ) : null}
    </div>
  );
}
