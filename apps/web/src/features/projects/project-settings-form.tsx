'use client';

import type { ProjectHealth, ProjectStatus } from '@orbit/shared/constants';
import { PROJECT_HEALTHS, PROJECT_STATUSES } from '@orbit/shared/constants';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { invalidateBootstrap } from '@/lib/query/bootstrap-cache.ts';
import { HEALTH_LABELS, STATUS_LABELS } from './health-chip.tsx';

export interface ProjectTeamOption {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface ProjectSettingsFormProps {
  readonly projectId: string;
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly teams: readonly ProjectTeamOption[];
  readonly selectedTeamIds: readonly string[];
  readonly canManage: boolean;
}

function dateValue(value: string | null): string {
  if (value === null) return '';
  return value.slice(0, 10);
}

export function ProjectSettingsForm({
  projectId,
  slug,
  name,
  summary,
  status,
  health,
  startDate,
  targetDate,
  teams,
  selectedTeamIds,
  canManage,
}: ProjectSettingsFormProps) {
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState({
    name,
    summary,
    status,
    health,
    startDate: dateValue(startDate),
    targetDate: dateValue(targetDate),
  });
  const [teamIds, setTeamIds] = useState<readonly string[]>(selectedTeamIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTeam(id: string): void {
    setTeamIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: {
          name: draft.name,
          summary: draft.summary,
          status: draft.status,
          health: draft.health,
          startDate: draft.startDate.length === 0 ? null : draft.startDate,
          targetDate: draft.targetDate.length === 0 ? null : draft.targetDate,
          teamIds: [...teamIds],
        },
      });
      invalidateBootstrap(client);
      toast({ title: 'Project updated', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  async function archive(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/projects/${projectId}?mode=archive`, { method: 'DELETE' });
      invalidateBootstrap(client);
      toast({ title: 'Project archived', tone: 'success' });
      router.push('/projects');
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  const fieldClass =
    'h-9 rounded-md border border-border bg-surface px-2.5 text-dense text-text outline-none focus-visible:border-accent';

  return (
    <form
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={onSubmit}
      data-testid="project-settings"
    >
      <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor="project-name-field">
        Name
        <Input
          id="project-name-field"
          value={draft.name}
          disabled={!canManage}
          data-testid="project-name"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-2xs text-faint" htmlFor="project-summary-field">
        Summary
        <Input
          id="project-summary-field"
          value={draft.summary}
          disabled={!canManage}
          data-testid="project-summary"
          onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-2xs text-faint">
          Status
          <select
            value={draft.status}
            disabled={!canManage}
            data-testid="project-status"
            className={fieldClass}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as ProjectStatus })
            }
          >
            {PROJECT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-2xs text-faint">
          Health
          <select
            value={draft.health}
            disabled={!canManage}
            data-testid="project-health"
            className={fieldClass}
            onChange={(event) =>
              setDraft({ ...draft, health: event.target.value as ProjectHealth })
            }
          >
            {PROJECT_HEALTHS.map((option) => (
              <option key={option} value={option}>
                {HEALTH_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-2xs text-faint">
          Start date
          <input
            type="date"
            value={draft.startDate}
            disabled={!canManage}
            data-testid="project-start"
            className={fieldClass}
            onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-2xs text-faint">
          Target date
          <input
            type="date"
            value={draft.targetDate}
            disabled={!canManage}
            data-testid="project-target"
            className={fieldClass}
            onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={!canManage}>
        <legend className="text-2xs text-faint">Teams</legend>
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            <label
              key={team.id}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-dense text-muted"
            >
              <input
                type="checkbox"
                checked={teamIds.includes(team.id)}
                data-testid={`project-team-${team.key}`}
                onChange={() => toggleTeam(team.id)}
              />
              {team.name}
            </label>
          ))}
        </div>
      </fieldset>

      {error === null ? null : (
        <p className="text-danger text-dense" data-testid="project-settings-error" role="alert">
          {error}
        </p>
      )}

      {canManage ? (
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending} data-testid="project-save">
            Save changes
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            data-testid="project-archive"
            onClick={() => {
              archive().catch(() => undefined);
            }}
          >
            Archive project
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-faint">
          You can see these settings but only an admin can change them.
        </p>
      )}

      <input type="hidden" value={slug} readOnly aria-hidden="true" />
    </form>
  );
}
