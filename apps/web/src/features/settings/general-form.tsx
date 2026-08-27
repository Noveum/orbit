'use client';

import { AGENT_INSTRUCTIONS_MAX_LENGTH } from '@orbit/shared/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
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
  readonly syncId: number;
  readonly canManage: boolean;
}

export function GeneralForm({
  name,
  logo,
  allowedEmailDomains,
  agentInstructions,
  syncId,
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

  const dirtyFields = useRef({
    name: false,
    logo: false,
    allowedEmailDomains: false,
    agentInstructions: false,
  });
  const nameBaseline = useRef(name);
  const logoBaseline = useRef(logo ?? '');
  const domainsBaseline = useRef(parseDomains(allowedEmailDomains.join(', ')));
  const instructionsBaseline = useRef(agentInstructions);
  const syncIdBaseline = useRef(syncId);

  useEffect(() => {
    nameBaseline.current = name;
    if (!dirtyFields.current.name) setWorkspaceName(name);
  }, [name]);

  useEffect(() => {
    logoBaseline.current = logo ?? '';
    if (!dirtyFields.current.logo) setLogoUrl(logo ?? '');
  }, [logo]);

  useEffect(() => {
    domainsBaseline.current = parseDomains(allowedEmailDomains.join(', '));
    if (!dirtyFields.current.allowedEmailDomains) {
      setDomains(allowedEmailDomains.join(', '));
    }
  }, [allowedEmailDomains]);

  useEffect(() => {
    if (!dirtyFields.current.agentInstructions) {
      instructionsBaseline.current = agentInstructions;
      syncIdBaseline.current = syncId;
      setInstructions(agentInstructions);
    }
  }, [agentInstructions, syncId]);

  const parsedDomains = parseDomains(domains);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const body: {
        name?: string;
        logo?: string | null;
        allowedEmailDomains?: string[];
        agentInstructions?: string;
        expectedSyncId?: number;
      } = {};
      if (dirtyFields.current.name) body.name = workspaceName;
      if (dirtyFields.current.logo) {
        body.logo = logoUrl.trim().length === 0 ? null : logoUrl.trim();
      }
      if (dirtyFields.current.allowedEmailDomains) body.allowedEmailDomains = parsedDomains;
      if (dirtyFields.current.agentInstructions) {
        body.agentInstructions = instructions;
        body.expectedSyncId = syncIdBaseline.current;
      }

      const result = await apiRequest<{ organization: { syncId: number } }>(
        '/api/organizations/current',
        {
          method: 'PATCH',
          body,
        },
      );
      nameBaseline.current = workspaceName;
      logoBaseline.current = logoUrl;
      domainsBaseline.current = parsedDomains;
      instructionsBaseline.current = instructions;
      syncIdBaseline.current = result.organization.syncId;
      dirtyFields.current.name = false;
      dirtyFields.current.logo = false;
      dirtyFields.current.allowedEmailDomains = false;
      dirtyFields.current.agentInstructions = false;
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
            onChange={(event) => {
              const value = event.target.value;
              setWorkspaceName(value);
              dirtyFields.current.name = value !== nameBaseline.current;
            }}
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
            onChange={(event) => {
              const value = event.target.value;
              setLogoUrl(value);
              dirtyFields.current.logo = value.trim() !== logoBaseline.current.trim();
            }}
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
            onChange={(event) => {
              const value = event.target.value;
              setDomains(value);
              const nextDomains = parseDomains(value);
              dirtyFields.current.allowedEmailDomains =
                nextDomains.length !== domainsBaseline.current.length ||
                nextDomains.some((domain, index) => domain !== domainsBaseline.current[index]);
            }}
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
          <Textarea
            id="settings-agent-instructions"
            value={instructions}
            onChange={(event) => {
              const value = event.target.value;
              setInstructions(value);
              dirtyFields.current.agentInstructions = value !== instructionsBaseline.current;
            }}
            maxLength={AGENT_INSTRUCTIONS_MAX_LENGTH}
            name="agentInstructions"
            rows={8}
            aria-label="Agent instructions"
            aria-describedby="settings-agent-instructions-help settings-agent-instructions-count"
            placeholder="Describe how this workspace works for connected agents."
          />
          <span id="settings-agent-instructions-help" className="text-faint text-xs">
            Shared workspace guidance for connected agents. This is advisory context, not a
            permission boundary.
          </span>
          <span id="settings-agent-instructions-count" className="text-faint text-xs">
            {instructions.length} / {AGENT_INSTRUCTIONS_MAX_LENGTH} characters
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
