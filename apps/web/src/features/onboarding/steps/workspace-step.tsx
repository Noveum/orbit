'use client';

import { ORG_SIZES, type OrgSize } from '@orbit/shared/constants';
import { slugify } from '@orbit/shared/utils';
import { organizationCreateSchema, workspaceSlugSchema } from '@orbit/shared/validators';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover, tabHover } from '@/lib/interaction.ts';
import { advanceStep } from '../api.ts';
import type { OnboardingStatusView, PendingInviteView } from '../types.ts';

const SIZE_LABELS: Record<OrgSize, string> = {
  just_me: 'Just me',
  '2_10': '2 to 10 people',
  '11_50': '11 to 50 people',
  '51_200': '51 to 200 people',
  '201_500': '201 to 500 people',
  '500_plus': 'More than 500 people',
};

interface CreatedWorkspace {
  readonly organization: { readonly id: string; readonly slug: string };
  readonly team: { readonly key: string };
}

type OnNext = (status: OnboardingStatusView) => void;

function CreateWorkspacePanel({ onNext }: { readonly onNext: OnNext }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [orgSize, setOrgSize] = useState<OrgSize>('2_10');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const parsed = organizationCreateSchema.safeParse({ name, slug: effectiveSlug });
  const slugCheck = workspaceSlugSchema.safeParse(effectiveSlug);
  const slugMessage =
    effectiveSlug.length > 0 && !slugCheck.success
      ? (slugCheck.error.issues[0]?.message ?? 'Pick another address.')
      : null;

  async function submit(): Promise<void> {
    if (!parsed.success) {
      setError('Give the workspace a name and a valid address.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await apiRequest<CreatedWorkspace>('/api/organizations', {
        method: 'POST',
        body: parsed.data,
      });
      const activated = await authClient.organization.setActive({
        organizationId: created.organization.id,
      });
      if (activated.error) {
        throw new Error(activated.error.message ?? 'Could not switch to the new workspace.');
      }
      onNext(await advanceStep({ step: 'workspace', via: 'create', orgSize }));
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit().catch(() => undefined);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5"
      data-testid="onboarding-workspace-create"
    >
      <fieldset disabled={pending} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-ws-name" className="font-medium text-dense text-text">
            Workspace name
          </label>
          <Input
            id="onboarding-ws-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
            placeholder="Noveum Labs"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-ws-slug" className="font-medium text-dense text-text">
            Workspace address
          </label>
          <Input
            id="onboarding-ws-slug"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value);
            }}
            required
            minLength={2}
            maxLength={48}
            placeholder="noveum-labs"
            autoComplete="off"
            aria-invalid={slugMessage !== null}
            aria-describedby="onboarding-ws-slug-hint"
          />
          <span
            id="onboarding-ws-slug-hint"
            className={slugMessage === null ? 'text-faint text-xs' : 'text-danger text-xs'}
          >
            {slugMessage ?? 'Lowercase letters, numbers and dashes.'}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-ws-size" className="font-medium text-dense text-text">
            How many people will use it?
          </label>
          <Select value={orgSize} onValueChange={(value) => setOrgSize(value as OrgSize)}>
            <SelectTrigger id="onboarding-ws-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_SIZES.map((size) => (
                <SelectItem key={size} value={size}>
                  {SIZE_LABELS[size]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending || !parsed.success}>
          {pending ? 'Creating' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}

function JoinWorkspacePanel({
  invites,
  onNext,
}: {
  readonly invites: readonly PendingInviteView[];
  readonly onNext: OnNext;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleInvite(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (selected.size === 0) {
      setError('Pick at least one workspace to join.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { onboarding } = await apiRequest<{ onboarding: OnboardingStatusView }>(
        '/api/onboarding/join',
        { method: 'POST', body: { inviteIds: [...selected] } },
      );
      onNext(onboarding);
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit().catch(() => undefined);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5"
      data-testid="onboarding-workspace-join"
    >
      <ul className="flex flex-col gap-2">
        {invites.map((invite) => {
          const checked = selected.has(invite.id);
          const inputId = `invite-${invite.id}`;
          return (
            <li key={invite.id}>
              <label
                htmlFor={inputId}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                  checked
                    ? 'border-accent bg-surface-2'
                    : cn('border-border bg-surface', cardHover),
                )}
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  onCheckedChange={() => toggleInvite(invite.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-dense text-text">
                    {invite.organizationName}
                  </span>
                  <span className="block truncate text-2xs text-faint">
                    Joining as {invite.role}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending || selected.size === 0}>
          {pending ? 'Joining' : 'Join workspace'}
        </Button>
      </div>
    </form>
  );
}

export interface WorkspaceStepProps {
  readonly invites: readonly PendingInviteView[];
  readonly onNext: OnNext;
}

export function WorkspaceStep({ invites, onNext }: WorkspaceStepProps) {
  const hasInvites = invites.length > 0;
  const [mode, setMode] = useState<'join' | 'create'>(hasInvites ? 'join' : 'create');

  return (
    <div className="flex flex-col gap-6" data-testid="onboarding-workspace">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">
          {mode === 'join' ? 'Join your team' : 'Create your workspace'}
        </h1>
        <p className="text-muted text-dense">
          A workspace holds your teams, issues, docs, and members.
        </p>
      </header>

      {hasInvites ? (
        <fieldset className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          <legend className="sr-only">Workspace mode</legend>
          <button
            type="button"
            aria-pressed={mode === 'join'}
            onClick={() => setMode('join')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-dense',
              tabHover,
              mode === 'join' ? 'bg-surface-2 text-text' : 'text-muted',
            )}
          >
            Join a workspace
          </button>
          <button
            type="button"
            aria-pressed={mode === 'create'}
            onClick={() => setMode('create')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-dense',
              tabHover,
              mode === 'create' ? 'bg-surface-2 text-text' : 'text-muted',
            )}
          >
            Create a new one
          </button>
        </fieldset>
      ) : null}

      {mode === 'join' ? (
        <JoinWorkspacePanel invites={invites} onNext={onNext} />
      ) : (
        <CreateWorkspacePanel onNext={onNext} />
      )}
    </div>
  );
}
