'use client';

import { Check, Fingerprint, Loader2 } from 'lucide-react';
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

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Try again.';
}

function PasskeyIcon({ verifying, verified }: { verifying: boolean; verified: boolean }) {
  if (verifying) return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (verified) return <Check className="size-4" aria-hidden="true" />;
  return <Fingerprint className="size-4" aria-hidden="true" />;
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
  const [verified, setVerified] = useState(!requirePasskey);
  const [verifying, setVerifying] = useState(false);

  const permissions = scopes.filter((entry) => SCOPE_LABELS[entry] !== undefined);

  async function verifyPasskey(): Promise<void> {
    setVerifying(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) throw new Error(result.error.message ?? 'No passkey available.');
      setVerified(true);
    } catch (error: unknown) {
      toast({ title: 'Passkey check failed', description: messageOf(error), tone: 'danger' });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <form method="post" action="/oauth/authorize/decision" className="flex flex-col gap-5">
      <input type="hidden" name="consent_code" value={consentCode} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="scope" value={scope} />

      <p className="text-center text-muted text-sm">
        <span className="font-medium text-text">{clientName}</span> wants to act in Orbit as{' '}
        <span className="font-medium text-text">{userEmail}</span>.
      </p>

      <label className="flex flex-col gap-1.5 text-2xs text-faint">
        Workspace
        <select
          name="organization_id"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
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

      {requirePasskey ? (
        <Button
          type="button"
          variant="secondary"
          block
          disabled={verified || verifying}
          onClick={() => {
            verifyPasskey();
          }}
        >
          <PasskeyIcon verifying={verifying} verified={verified} />
          {verified ? 'Passkey verified' : 'Verify with your passkey'}
        </Button>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" name="decision" value="deny" variant="ghost" block>
          Deny
        </Button>
        <Button
          type="submit"
          name="decision"
          value="allow"
          variant="primary"
          block
          disabled={!verified || organizationId === ''}
        >
          Approve
        </Button>
      </div>

      {requirePasskey && !verified ? (
        <p className="text-center text-2xs text-faint">
          Verify with your passkey to approve this connection.
        </p>
      ) : null}
    </form>
  );
}
