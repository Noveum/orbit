'use client';

import type { ProjectStatus } from '@orbit/shared/constants';
import { PROJECT_STATUSES } from '@orbit/shared/constants';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { invalidateBootstrap } from '@/lib/query/bootstrap-cache.ts';
import { formatDay } from './dates.ts';
import { STATUS_LABELS } from './health-chip.tsx';

export interface ProjectPerson {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface ProjectTeamChoice {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface ProjectFieldsProps {
  readonly projectId: string;
  readonly lead: ProjectPerson | null;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly status: ProjectStatus;
  readonly teamIds: readonly string[];
  readonly members: readonly ProjectPerson[];
  readonly teams: readonly ProjectTeamChoice[];
  readonly canManage: boolean;
  readonly progress: ReactNode;
}

const fieldTrigger =
  'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-2 hover:text-text motion-reduce:transition-none';

function LeadName({ lead }: { readonly lead: ProjectPerson | null }) {
  if (lead === null) return <>Unassigned</>;
  return (
    <>
      <Avatar name={lead.name} src={lead.image} size="xs" />
      {lead.name}
    </>
  );
}

function TeamBadges({
  teams,
  chosen,
}: {
  readonly teams: readonly ProjectTeamChoice[];
  readonly chosen: ReadonlySet<string>;
}) {
  if (chosen.size === 0) return <>None</>;
  return (
    <span className="flex gap-1">
      {teams
        .filter((team) => chosen.has(team.id))
        .map((team) => (
          <Badge key={team.id} tone="outline">
            {team.key}
          </Badge>
        ))}
    </span>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className="flex items-center gap-1.5 text-muted">{children}</dd>
    </div>
  );
}

export function useProjectPatch(projectId: string) {
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const patch = (body: Record<string, unknown>) => {
    setPending(true);
    apiRequest(`/api/projects/${projectId}`, { method: 'PATCH', body })
      .then(() => {
        invalidateBootstrap(client);
        router.refresh();
      })
      .catch((error: unknown) =>
        toast({ title: 'Could not save', description: messageOf(error), tone: 'danger' }),
      )
      .finally(() => setPending(false));
  };

  return { patch, pending };
}

function DateField({
  label,
  value,
  testId,
  canManage,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly testId: string;
  readonly canManage: boolean;
  readonly onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = formatDay(value, { withYear: true, missing: 'Not set' });

  if (!canManage) {
    return (
      <Field label={label}>
        <span className="tabular">{shown}</span>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Change the ${label.toLowerCase()} date`}
          data-testid={testId}
          className={cn(fieldTrigger, 'tabular')}
        >
          {shown}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <Input
            type="date"
            defaultValue={value === null ? '' : value.slice(0, 10)}
            aria-label={`${label} date`}
            data-testid={`${testId}-input`}
            className="h-8"
            onChange={(event) => {
              onChange(event.target.value.length === 0 ? null : event.target.value);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function TeamPicker({
  teams,
  teamIds,
  pending,
  onChange,
}: {
  readonly teams: readonly ProjectTeamChoice[];
  readonly teamIds: readonly string[];
  readonly pending: boolean;
  readonly onChange: (next: readonly string[]) => void;
}) {
  const saved = teamIds.join(',');
  const [chosen, setChosen] = useState<readonly string[]>(teamIds);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setChosen(teamIds);
  }
  const picked = new Set(chosen);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change which teams own this project"
        data-testid="project-teams"
        disabled={pending}
        className={fieldTrigger}
      >
        <TeamBadges teams={teams} chosen={picked} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {teams.map((team) => (
          <DropdownMenuItem
            key={team.id}
            data-testid={`project-team-${team.id}`}
            onSelect={(event) => {
              event.preventDefault();
              const next = picked.has(team.id)
                ? chosen.filter((id) => id !== team.id)
                : [...chosen, team.id];
              setChosen(next);
              onChange(next);
            }}
          >
            <span className="flex-1 truncate">{team.name}</span>
            {picked.has(team.id) ? (
              <Check className="size-3.5 text-accent" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectFields({
  projectId,
  lead,
  startDate,
  targetDate,
  status,
  teamIds,
  members,
  teams,
  canManage,
  progress,
}: ProjectFieldsProps) {
  const { patch, pending } = useProjectPatch(projectId);

  return (
    <dl
      className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs"
      data-testid="project-fields"
    >
      <Field label="Lead">
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Change the project lead"
              data-testid="project-lead"
              disabled={pending}
              className={fieldTrigger}
            >
              <LeadName lead={lead} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuItem
                data-testid="project-lead-none"
                onSelect={() => patch({ leadId: null })}
              >
                <span className="flex-1">Unassigned</span>
                {lead === null ? (
                  <Check className="size-3.5 text-accent" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.id}
                  data-testid={`project-lead-${member.id}`}
                  onSelect={() => patch({ leadId: member.id })}
                >
                  <Avatar name={member.name} src={member.image} size="xs" />
                  <span className="flex-1 truncate">{member.name}</span>
                  {lead?.id === member.id ? (
                    <Check className="size-3.5 text-accent" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <LeadName lead={lead} />
        )}
      </Field>

      <DateField
        label="Start"
        value={startDate}
        testId="project-start-date"
        canManage={canManage}
        onChange={(next) => patch({ startDate: next })}
      />
      <DateField
        label="Target"
        value={targetDate}
        testId="project-target-date"
        canManage={canManage}
        onChange={(next) => patch({ targetDate: next })}
      />

      <Field label="Status">
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Change the project status"
              data-testid="project-status-field"
              disabled={pending}
              className={fieldTrigger}
            >
              {STATUS_LABELS[status]}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {PROJECT_STATUSES.map((option) => (
                <DropdownMenuItem
                  key={option}
                  data-testid={`project-status-${option}`}
                  onSelect={() => patch({ status: option })}
                >
                  <span className="flex-1">{STATUS_LABELS[option]}</span>
                  {status === option ? (
                    <Check className="size-3.5 text-accent" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          STATUS_LABELS[status]
        )}
      </Field>

      <Field label="Teams">
        {canManage ? (
          <TeamPicker
            teams={teams}
            teamIds={teamIds}
            pending={pending}
            onChange={(next) => patch({ teamIds: next })}
          />
        ) : (
          <TeamBadges teams={teams} chosen={new Set(teamIds)} />
        )}
      </Field>

      <Field label="Progress">{progress}</Field>
    </dl>
  );
}
