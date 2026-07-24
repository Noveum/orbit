'use client';

import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { MemberView } from './data.ts';

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  member: 'Member',
  contributor: 'Contributor',
  guest: 'Guest',
};

function formatJoined(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export interface MembersTableProps {
  readonly members: readonly MemberView[];
  readonly canManage: boolean;
}

export function MembersTable({ members, canManage }: MembersTableProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setError(memberId: string, message: string | null): void {
    setErrors((current) => {
      if (message !== null) return { ...current, [memberId]: message };
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== memberId));
    });
  }

  async function run(memberId: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(memberId);
    setError(memberId, null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(memberId, messageOf(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="row-stack w-full border-collapse md:min-w-[52rem] text-dense">
        <thead>
          <tr className="border-border border-b text-2xs text-faint uppercase">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Member
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Email
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Role
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Teams
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Joined
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.memberId}
              className={cn('border-border border-b last:border-b-0', rowHover)}
            >
              <td className="px-3 py-2 align-top">
                <span className="flex items-center gap-2">
                  <Avatar name={member.name} src={member.image} size="sm" />
                  <span className="flex flex-col">
                    <span className="text-text">{member.name}</span>
                    {member.handle === null ? null : (
                      <span className="text-faint text-2xs">@{member.handle}</span>
                    )}
                  </span>
                </span>
              </td>
              <td data-label="Email" className="px-3 py-2 align-top text-muted">
                {member.email}
              </td>
              <td data-label="Role" className="px-3 py-2 align-top">
                <Select
                  value={member.role}
                  disabled={!canManage || busyId === member.memberId}
                  onValueChange={(role) =>
                    run(member.memberId, () =>
                      apiRequest(`/api/members/${member.memberId}`, {
                        method: 'PATCH',
                        body: { role },
                      }),
                    )
                  }
                >
                  <SelectTrigger
                    className="h-7 w-36 text-xs"
                    aria-label={`Role for ${member.name}`}
                  >
                    <SelectValue>{ROLE_LABELS[member.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors[member.memberId] === undefined ? null : (
                  <p role="alert" className="mt-1 max-w-48 text-danger text-2xs">
                    {errors[member.memberId]}
                  </p>
                )}
              </td>
              <td data-label="Teams" className="px-3 py-2 align-top">
                <span className="flex flex-wrap gap-1">
                  {member.teams.length === 0 ? (
                    <span className="text-faint text-xs">No teams</span>
                  ) : (
                    member.teams.map((team) => (
                      <Badge key={team.id} tone="outline">
                        {team.key}
                      </Badge>
                    ))
                  )}
                </span>
              </td>
              <td data-label="Joined" className="px-3 py-2 align-top text-muted tabular">
                {formatJoined(member.joinedAt)}
              </td>
              <td className="px-3 py-2 text-right align-top">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canManage || busyId === member.memberId}
                  onClick={() =>
                    run(member.memberId, () =>
                      apiRequest(`/api/members/${member.memberId}`, { method: 'DELETE' }),
                    )
                  }
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
