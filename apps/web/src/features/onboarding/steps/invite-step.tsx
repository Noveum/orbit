'use client';

import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { emailSchema } from '@orbit/shared/validators';
import { Plus, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { advanceStep } from '../api.ts';
import type { OnboardingStatusView } from '../types.ts';

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  member: 'Member',
  contributor: 'Contributor',
  guest: 'Guest',
};

interface InviteRow {
  readonly id: string;
  readonly email: string;
  readonly role: OrgRole;
}

let rowCounter = 0;
function emptyRow(): InviteRow {
  rowCounter += 1;
  return { id: `row-${rowCounter}`, email: '', role: 'member' };
}

export interface InviteStepProps {
  readonly onNext: (status: OnboardingStatusView) => void;
}

export function InviteStep({ onNext }: InviteStepProps) {
  const [rows, setRows] = useState<InviteRow[]>(() => [emptyRow(), emptyRow(), emptyRow()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(id: string, patch: Partial<InviteRow>): void {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(id: string): void {
    setRows((current) => (current.length <= 1 ? current : current.filter((row) => row.id !== id)));
  }

  function onEmailKeyDown(event: KeyboardEvent<HTMLInputElement>, isLast: boolean): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (isLast && event.currentTarget.value.trim().length > 0) addRow();
  }

  const validInvites = rows
    .map((row) => ({ email: row.email.trim(), role: row.role }))
    .filter((row) => emailSchema.safeParse(row.email).success);

  async function skip(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      onNext(await advanceStep({ step: 'invite' }));
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  async function send(): Promise<void> {
    if (validInvites.length === 0) {
      setError('Add at least one email, or skip this step.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/invites', {
        method: 'POST',
        body: { invites: validInvites.map((row) => ({ email: row.email, role: row.role })) },
      });
      onNext(await advanceStep({ step: 'invite' }));
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="onboarding-invite">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">Invite your teammates</h1>
        <p className="text-muted text-dense">
          They will get an email to join. You can always add more later.
        </p>
      </header>

      <fieldset disabled={pending} className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const invalid =
            row.email.trim().length > 0 && !emailSchema.safeParse(row.email.trim()).success;
          return (
            <div key={row.id} className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Input
                  type="email"
                  value={row.email}
                  onChange={(event) => updateRow(row.id, { email: event.target.value })}
                  onKeyDown={(event) => onEmailKeyDown(event, index === rows.length - 1)}
                  placeholder="teammate@company.com"
                  autoComplete="off"
                  aria-label={`Teammate ${index + 1} email`}
                  aria-invalid={invalid}
                />
                {invalid ? (
                  <span role="alert" className="text-danger text-xs">
                    That does not look like an email.
                  </span>
                ) : null}
              </div>
              <div className="w-40 shrink-0">
                <Select
                  value={row.role}
                  onValueChange={(value) => updateRow(row.id, { role: value as OrgRole })}
                >
                  <SelectTrigger aria-label={`Teammate ${index + 1} role`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove teammate ${index + 1}`}
                disabled={rows.length <= 1}
                className="px-2"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </fieldset>

      <div>
        <Button type="button" variant="ghost" size="sm" onClick={addRow} disabled={pending}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add another
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => send().catch(() => undefined)}
          disabled={pending}
        >
          {pending ? 'Sending' : 'Send invites'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => skip().catch(() => undefined)}
          disabled={pending}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}
