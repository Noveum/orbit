import { and, eq, gte, isNull, not, or, schema, sql } from '@orbit/db';
import {
  type NotificationEvent,
  notifyMany,
  projectConversationKey,
} from '@orbit/services/notifications';
import type { Executor } from '../internal.ts';

export const DEFAULT_PROJECT_STALENESS_DAYS = 14;
export const PROJECT_STALENESS_NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StaleProjectNudgeOutcome {
  readonly nudged: number;
  readonly suppressed: number;
}

interface StaleProjectRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly leadId: string | null;
  readonly lastUpdateAt: Date | string | null;
}

interface StalenessOrganization {
  readonly id: string;
  readonly stalenessDays: number;
}

function nudgeBucket(now: Date): number {
  return Math.floor(now.getTime() / PROJECT_STALENESS_NUDGE_INTERVAL_MS);
}

function staleSince(
  project: StaleProjectRow,
  windowDays: number,
  now: Date,
): Date | null | undefined {
  if (project.lastUpdateAt === null) return null;
  const updated = new Date(project.lastUpdateAt);
  const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
  return updated < cutoff ? updated : undefined;
}

function staleProjectEvent(
  organizationId: string,
  project: StaleProjectRow,
  lastUpdateAt: Date | null,
  userIds: readonly string[],
  bucket: number,
  now: Date,
): NotificationEvent {
  const days =
    lastUpdateAt === null ? null : Math.floor((now.getTime() - lastUpdateAt.getTime()) / DAY_MS);
  const body =
    days === null
      ? 'No health update has been posted yet.'
      : `No health update in ${days} ${days === 1 ? 'day' : 'days'}.`;
  return {
    organizationId,
    type: 'project_stale',
    reason: 'stale',
    actor: { type: 'system', id: 'project-staleness', name: 'Project staleness' },
    entityType: 'project',
    entityId: project.id,
    userIds: [...userIds],
    title: `Project ${project.name} has gone stale`,
    body,
    url: `/projects/${project.slug}`,
    source: {
      sourceEventKey: `orbit-project-stale:${project.id}:${bucket}`,
      subjectType: 'project',
      subjectKey: projectConversationKey(project.id),
      occurredAt: now,
      payload: { entityType: 'project', entityId: project.id, subjectId: project.id },
    },
  };
}

function staleProjectEvents(
  organization: StalenessOrganization,
  projects: readonly StaleProjectRow[],
  adminIds: readonly string[],
  bucket: number,
  now: Date,
): { events: NotificationEvent[]; suppressed: number } {
  const events: NotificationEvent[] = [];
  let suppressed = 0;
  for (const project of projects) {
    const lastUpdateAt = staleSince(project, organization.stalenessDays, now);
    if (lastUpdateAt === undefined) continue;
    const userIds = project.leadId === null ? adminIds : [project.leadId];
    if (userIds.length === 0) {
      suppressed += 1;
      continue;
    }
    events.push(staleProjectEvent(organization.id, project, lastUpdateAt, userIds, bucket, now));
  }
  return { events, suppressed };
}

async function stalenessOrganizations(executor: Executor): Promise<StalenessOrganization[]> {
  return await executor
    .select({
      id: schema.organization.id,
      stalenessDays: schema.organization.projectStalenessDays,
    })
    .from(schema.organization)
    .where(gte(schema.organization.projectStalenessDays, 1));
}

async function activeProjects(executor: Executor, organizationId: string) {
  return await executor
    .select({
      id: schema.project.id,
      name: schema.project.name,
      slug: schema.project.slug,
      leadId: schema.project.leadId,
      lastUpdateAt: sql<Date | string | null>`max(${schema.projectUpdate.createdAt})`,
    })
    .from(schema.project)
    .leftJoin(schema.projectUpdate, eq(schema.projectUpdate.projectId, schema.project.id))
    .where(
      and(
        eq(schema.project.organizationId, organizationId),
        isNull(schema.project.archivedAt),
        not(or(eq(schema.project.status, 'completed'), eq(schema.project.status, 'canceled'))),
      ),
    )
    .groupBy(schema.project.id);
}

async function adminIdsFor(executor: Executor, organizationId: string): Promise<string[]> {
  const admins = await executor
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.role, 'admin')));
  return admins.map((row) => row.userId);
}

export async function nudgeStaleProjects(
  executor: Executor,
  now: Date = new Date(),
): Promise<StaleProjectNudgeOutcome> {
  const organizations = await stalenessOrganizations(executor);
  if (organizations.length === 0) return { nudged: 0, suppressed: 0 };

  const bucket = nudgeBucket(now);
  let nudged = 0;
  let suppressed = 0;

  for (const organization of organizations) {
    const projects = await activeProjects(executor, organization.id);
    if (projects.length === 0) continue;
    const adminIds = await adminIdsFor(executor, organization.id);
    const candidate = staleProjectEvents(organization, projects, adminIds, bucket, now);
    suppressed += candidate.suppressed;
    if (candidate.events.length === 0) continue;
    const outcome = await notifyMany(executor, candidate.events);
    nudged += outcome.notifications.length;
  }

  return { nudged, suppressed };
}
