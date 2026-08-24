'use client';

import { AGENT_INSTRUCTIONS_MAX_LENGTH } from '@orbit/shared/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

export function parseDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
        .filter((entry) => entry.length > 0),
    ),
  ];
}

export interface GeneralFormProps {
  readonly name: string;
  readonly logo: string | null;
  readonly allowedEmailDomains: readonly string[];
  readonly agentInstructions: string;
  readonly canManage: boolean;
}

export function GeneralForm({
  name,
  logo,
  allowedEmailDomains,
  agentInstructions,
  canManage,
}: GeneralFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [workspaceName, setWorkspaceName] = useState(name);
  const [logoUrl, setLogoUrl] = useState(logo ?? '');
  const [domains, setDomains] = useState(allowedEmailDomains.join(', '));
  const [instructions, setInstructions] = useState(agentInstructions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedDomains = parseDomains(domains);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/organizations/current', {
        method: 'PATCH',
        body: {
          name: workspaceName,
          logo: logoUrl.trim().length === 0 ? null : logoUrl.trim(),
          allowedEmailDomains: parsedDomains,
          agentInstructions: instructions,
        },
      });
      toast({ title: 'Workspace updated', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {canManage ? null : (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-muted text-xs">
          Only workspace admins can change these settings. Ask an admin if something needs to
          change.
        </p>
      )}

      <fieldset disabled={!canManage || pending} className="flex flex-col gap-5">
        <label htmlFor="settings-name" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Workspace name</span>
          <Input
            id="settings-name"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            required
            minLength={2}
            maxLength={64}
            name="name"
          />
        </label>

        <label htmlFor="settings-logo" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Logo URL</span>
          <Input
            id="settings-logo"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            type="url"
            placeholder="https://example.com/logo.png"
            name="logo"
          />
          <span className="text-faint text-xs">Square images look best. Leave blank for none.</span>
        </label>

        <label htmlFor="settings-domains" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Allowed email domains</span>
          <Input
            id="settings-domains"
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="noveum.ai, example.com"
            name="allowedEmailDomains"
          />
          <span className="text-faint text-xs">
            Anyone with an email on these domains can join without an invite.
          </span>
          {parsedDomains.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {parsedDomains.map((domain) => (
                <Badge key={domain} tone="accent">
                  {domain}
                </Badge>
              ))}
            </span>
          ) : null}
        </label>

        <label htmlFor="settings-agent-instructions" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Agent instructions</span>
          <textarea
            id="settings-agent-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={AGENT_INSTRUCTIONS_MAX_LENGTH}
            name="agentInstructions"
            rows={8}
            aria-describedby="settings-agent-instructions-help settings-agent-instructions-count"
            className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-dense text-text placeholder:text-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] not-disabled:hover:border-border-strong focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Describe how this workspace works for connected agents."
          />
          <span id="settings-agent-instructions-help" className="text-faint text-xs">
            Shared workspace guidance for connected agents. This is advisory context, not a
            permission boundary.
          </span>
          <span id="settings-agent-instructions-count" className="text-faint text-xs">
            {instructions.length.toLocaleString()} /{' '}
            {AGENT_INSTRUCTIONS_MAX_LENGTH.toLocaleString()} characters
          </span>
        </label>
      </fieldset>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={!canManage || pending}>
          {pending ? 'Saving' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
