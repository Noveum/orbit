'use client';

import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { authClient } from '@/lib/auth/client.ts';

const SCOPE_LABELS: Record<string, string> = {
  'orbit.read': 'Read your issues, projects, sprints, docs, and workspace members',
  'orbit.write': 'Create and update issues, comments, projects, and sprints',
  offline_access: 'Stay connected without signing in again',
};

export interface ConsentOrganization {
  readonly id: string;
  readonly name: string;
}

export interface ConsentAgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
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
  readonly agentMcpEnabled?: boolean;
  readonly agentIdentities?: readonly ConsentAgentIdentity[];
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
  agentMcpEnabled = false,
  agentIdentities = [],
}: ConsentFormProps) {
  const { toast } = useToast();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [pending, setPending] = useState<Pending>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [connectionKind, setConnectionKind] = useState('legacy');
  const [identityId, setIdentityId] = useState('');
  const [agentName, setAgentName] = useState('');

  const agentAvailable = agentMcpEnabled && scopes.includes('orbit.read');
  const agentMode = agentAvailable && connectionKind === 'agent';
  const identities = agentIdentities.filter(
    (identity) => identity.organizationId === organizationId,
  );
  const identitySelected =
    identityId === ''
      ? agentName.trim().length > 0
      : identities.some((identity) => identity.id === identityId);
  const permissions = scopes.filter(
    (entry) => SCOPE_LABELS[entry] !== undefined && !(agentMode && entry === 'orbit.write'),
  );

  async function post(decision: 'allow' | 'deny'): Promise<DecisionResponse> {
    const response = await fetch('/oauth/authorize/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision,
        consentCode,
        clientId,
        scope,
        organizationId,
        ...(decision === 'allow' && agentMode
          ? { agent: identityId === '' ? { name: agentName.trim() } : { identityId } }
          : {}),
      }),
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

  async function returnToClient(): Promise<void> {
    const denied = await post('deny');
    if (typeof denied.redirectUri !== 'string') {
      throw new Error('Close this window and start the connection again.');
    }
    window.location.assign(denied.redirectUri);
  }

  function run(decision: 'allow' | 'deny'): void {
    if (pending !== null) return;
    setPending(decision);
    setBlocked(null);
    decide(decision, false).catch((error: unknown) => {
      setPending(null);
      if (decision === 'allow') setBlocked(messageOf(error));
      toast({ title: 'Could not connect', description: messageOf(error), tone: 'danger' });
    });
  }

  function abandon(): void {
    if (pending !== null) return;
    setPending('deny');
    returnToClient().catch((error: unknown) => {
      setPending(null);
      toast({ title: 'Could not connect', description: messageOf(error), tone: 'danger' });
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-center text-muted text-sm">
        <span className="font-medium text-text">{clientName}</span>{' '}
        {agentMode ? 'wants read-only access to Orbit authorized by' : 'wants to act in Orbit as'}{' '}
        <span className="font-medium text-text">{userEmail}</span>.
      </p>

      <label className="flex flex-col gap-1.5 text-2xs text-faint">
        Workspace
        <select
          value={organizationId}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setIdentityId('');
            setAgentName('');
          }}
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

      {agentAvailable ? (
        <label className="flex flex-col gap-1.5 text-2xs text-faint">
          Connection identity
          <select
            value={connectionKind}
            onChange={(event) => setConnectionKind(event.target.value)}
            disabled={pending !== null}
            className="h-9 rounded-md border border-border bg-surface px-2.5 text-dense text-text"
          >
            <option value="legacy">Human Principal ({userEmail})</option>
            <option value="agent">Agent Identity (read-only)</option>
          </select>
        </label>
      ) : null}

      {agentMode ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm">
            This Agent connection is read-only. It cannot create or update issues, comments,
            projects, or other workspace data. get_me and me still refer to you.
          </p>
          <label className="flex flex-col gap-1.5 text-2xs text-faint">
            Agent Identity
            <select
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
              disabled={pending !== null}
              className="h-9 rounded-md border border-border bg-surface px-2.5 text-dense text-text"
            >
              <option value="">Create a new Identity</option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.name}
                </option>
              ))}
            </select>
          </label>
          {identityId === '' ? (
            <label className="flex flex-col gap-1.5 text-2xs text-faint">
              Agent name
              <input
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                maxLength={100}
                disabled={pending !== null}
                className="h-9 rounded-md border border-border bg-surface px-2.5 text-dense text-text"
              />
            </label>
          ) : null}
        </div>
      ) : null}

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
          disabled={pending !== null || organizationId === '' || (agentMode && !identitySelected)}
          onClick={() => run('allow')}
        >
          {pending === 'allow' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Approve
        </Button>
      </div>

      {blocked === null && requirePasskey ? (
        <p className="text-center text-2xs text-faint">
          Approving prompts you to verify with your passkey.
        </p>
      ) : null}

      {blocked === null ? null : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
          <p className="text-2xs text-muted" data-testid="consent-blocked">
            {blocked}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={abandon}
            disabled={pending !== null}
          >
            Cancel and return to {clientName}
          </Button>
        </div>
      )}
    </div>
  );
}
