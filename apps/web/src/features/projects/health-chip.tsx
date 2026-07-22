import type { ProjectHealth, ProjectStatus } from '@orbit/shared/constants';
import { Badge } from '@/components/ui/badge.tsx';

const HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  no_update: 'No update',
};

const HEALTH_TONES: Record<ProjectHealth, 'success' | 'warning' | 'danger' | 'neutral'> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
  no_update: 'neutral',
};

const HEALTH_DOTS: Record<ProjectHealth, string> = {
  on_track: 'bg-success',
  at_risk: 'bg-warning',
  off_track: 'bg-danger',
  no_update: 'bg-faint',
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

export function healthLabel(health: ProjectHealth): string {
  return HEALTH_LABELS[health];
}

export function HealthChip({ health }: { readonly health: ProjectHealth }) {
  return (
    <Badge tone={HEALTH_TONES[health]}>
      <span className={`size-1.5 rounded-full ${HEALTH_DOTS[health]}`} aria-hidden="true" />
      {HEALTH_LABELS[health]}
    </Badge>
  );
}
