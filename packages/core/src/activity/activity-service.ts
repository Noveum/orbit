import { and, asc, desc, eq, schema, sql } from '@orbit/db';
import { PRIORITY_LABELS, type Priority, readableRelation } from '@orbit/shared/constants';
import type { Actor } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { type Executor, newId } from '../internal.ts';

export type ActivityRow = typeof schema.issueActivity.$inferSelect;

function legacyAssignee(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return { type: 'user', id: value };
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return { ...value, type: 'user', id: value.id };
  }
  return value;
}

export function canonicalActivityRead(row: ActivityRow): ActivityRow {
  return row.field === 'assigneeId'
    ? {
        ...row,
        field: 'assignee',
        fromValue: legacyAssignee(row.fromValue),
        toValue: legacyAssignee(row.toValue),
      }
    : row;
}

export interface ActivityChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface AppendActivityInput extends ActivityChange {
  readonly organizationId: string;
  readonly issueId: string;
  readonly actor: Actor;
  readonly syncId: number;
  readonly principalUserId?: string | null;
  readonly principalName?: string | null;
  readonly principalAvatar?: string | null;
  readonly grantId?: string | null;
  readonly actorAvatar?: string | null;
  readonly cause?: string | null;
  readonly causeActorId?: string | null;
}

export async function principalActor(executor: Executor, principal: Principal): Promise<Actor> {
  const [row] = await executor
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, principal.userId))
    .limit(1);
  return { type: 'user', id: principal.userId, name: row?.name ?? 'Someone' };
}

export interface PrincipalActorProfile {
  readonly actor: Actor;
  readonly avatar: string | null;
}

export interface ActivityAgentActor {
  readonly actor: Actor;
  readonly avatar: string | null;
  readonly principal: Principal;
  readonly principalName: string;
  readonly principalAvatar: string | null;
  readonly grantId: string;
}

export interface ActivityActorSnapshot {
  readonly actor: Actor;
  readonly actorAvatar: string | null;
  readonly principalUserId: string;
  readonly principalName: string | null;
  readonly principalAvatar: string | null;
  readonly grantId: string | null;
}

export async function resolveActivityActor(
  executor: Executor,
  principal: Principal,
  agent: ActivityAgentActor | null = null,
): Promise<ActivityActorSnapshot> {
  if (agent !== null) {
    return {
      actor: agent.actor,
      actorAvatar: agent.avatar,
      principalUserId: agent.principal.userId,
      principalName: agent.principalName,
      principalAvatar: agent.principalAvatar,
      grantId: agent.grantId,
    };
  }
  const profile = await principalActorProfile(executor, principal);
  return {
    actor: profile.actor,
    actorAvatar: profile.avatar,
    principalUserId: principal.userId,
    principalName: profile.actor.name ?? null,
    principalAvatar: profile.avatar,
    grantId: null,
  };
}

export async function principalActorProfile(
  executor: Executor,
  principal: Principal,
): Promise<PrincipalActorProfile> {
  const [row] = await executor
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, principal.userId))
    .limit(1);
  return {
    actor: { type: 'user', id: principal.userId, name: row?.name ?? 'Someone' },
    avatar: row?.image ?? null,
  };
}

export async function appendActivities(
  executor: Executor,
  inputs: readonly AppendActivityInput[],
): Promise<ActivityRow[]> {
  if (inputs.length === 0) return [];
  return await executor
    .insert(schema.issueActivity)
    .values(
      inputs.map((input) => ({
        id: newId(),
        organizationId: input.organizationId,
        issueId: input.issueId,
        actorType: input.actor.type,
        actorId: input.actor.id,
        actorName: input.actor.name ?? 'Someone',
        principalUserId:
          input.principalUserId ?? (input.actor.type === 'user' ? input.actor.id : null),
        principalName:
          input.principalName ?? (input.actor.type === 'user' ? (input.actor.name ?? null) : null),
        actorAvatar: input.actorAvatar ?? null,
        principalAvatar: input.principalAvatar ?? null,
        grantId: input.grantId ?? null,
        field: input.field,
        fromValue: input.from ?? null,
        toValue: input.to ?? null,
        cause: input.cause ?? null,
        causeActorId: input.causeActorId ?? null,
        syncId: input.syncId,
      })),
    )
    .returning();
}

export async function appendActivity(
  executor: Executor,
  input: AppendActivityInput,
): Promise<ActivityRow> {
  const [row] = await appendActivities(executor, [input]);
  if (row === undefined) throw new Error('Activity row was not written.');
  return row;
}

export interface ActivityPage {
  readonly activity: ActivityRow[];
  readonly nextCursor: string | null;
}

export interface ActivityQuery {
  readonly limit?: number;
  readonly oldestFirst?: boolean;
  readonly cursor?: string | undefined;
}

export async function listActivityPage(
  executor: Executor,
  principal: Principal,
  issueId: string,
  options: ActivityQuery = {},
): Promise<ActivityPage> {
  assertCan(principal, 'issue:read');
  const ascending = options.oldestFirst === true;
  const order = ascending ? asc : desc;
  const limit = options.limit ?? 100;

  const filters = [
    eq(schema.issueActivity.organizationId, principal.organizationId),
    eq(schema.issueActivity.issueId, issueId),
  ];
  if (options.cursor !== undefined) {
    const comparison = ascending ? sql`>` : sql`<`;
    filters.push(
      sql`(${schema.issueActivity.createdAt}, ${schema.issueActivity.id}) ${comparison} (select ${schema.issueActivity.createdAt}, ${schema.issueActivity.id} from ${schema.issueActivity} where ${schema.issueActivity.id} = ${options.cursor})`,
    );
  }

  const rows = await executor
    .select()
    .from(schema.issueActivity)
    .where(and(...filters))
    .orderBy(order(schema.issueActivity.createdAt), order(schema.issueActivity.id))
    .limit(limit + 1);

  const activity = rows.slice(0, limit).map(canonicalActivityRead);
  return {
    activity,
    nextCursor: rows.length > limit ? (activity.at(-1)?.id ?? null) : null,
  };
}

export async function listActivity(
  executor: Executor,
  principal: Principal,
  issueId: string,
  options: { limit?: number; oldestFirst?: boolean } = {},
): Promise<ActivityRow[]> {
  const page = await listActivityPage(executor, principal, issueId, options);
  return page.activity;
}

function nameOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'name' in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function assigneeNameOf(value: unknown): string | null {
  const name = nameOf(value);
  if (name !== null) return name;
  if (value !== null && typeof value === 'object' && 'type' in value) {
    if (value.type === 'agent') return 'an agent';
    if (value.type === 'user') return 'a member';
  }
  return null;
}

function describePriority(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(nameOf(value) ?? Number.NaN);
  const label = PRIORITY_LABELS[numeric as Priority];
  return label ?? 'No priority';
}

const SIMPLE_FIELD_COPY: Record<string, string> = {
  description: 'updated the description',
  estimate: 'changed the estimate',
  sortOrder: 'reordered the issue',
  archived: 'archived the issue',
  unarchived: 'restored the issue',
  created: 'created the issue',
  subscribed: 'subscribed to the issue',
  unsubscribed: 'unsubscribed from the issue',
  reviewerIds: 'changed the reviewers',
};

interface RenderedChange {
  readonly from: string | null;
  readonly to: string | null;
}

const FIELD_RENDERERS: Record<string, (change: RenderedChange) => string> = {
  assignee: ({ from, to }) =>
    to === null ? `unassigned ${from ?? 'the issue'}` : `assigned to ${to}`,
  stateId: ({ from, to }) =>
    from === null
      ? `set the status to ${to ?? 'unknown'}`
      : `moved from ${from} to ${to ?? 'unknown'}`,
  assigneeId: ({ from, to }) =>
    to === null ? `unassigned ${from ?? 'the issue'}` : `assigned to ${to}`,
  title: ({ to }) => `renamed to "${to ?? ''}"`,
  dueDate: ({ to }) => (to === null ? 'cleared the due date' : `set the due date to ${to}`),
  labelId: ({ from, to }) => (to === null ? `removed label ${from ?? ''}` : `added label ${to}`),
  relation: ({ from, to }) => {
    if (to !== null) return `marked as ${readableRelation(to)}`;
    if (from === null) return 'removed a relation';
    return `removed a ${readableRelation(from)} relation`;
  },
  projectId: ({ to }) => (to === null ? 'removed from its project' : `moved to project ${to}`),
  cycleId: ({ to }) => (to === null ? 'removed from its cycle' : `moved to ${to}`),
  milestoneId: ({ to }) => (to === null ? 'removed from its milestone' : `moved to ${to}`),
  parentId: ({ to }) => (to === null ? 'is no longer a sub-issue' : `made a sub-issue of ${to}`),
};

export function describeActivity(
  row: Pick<ActivityRow, 'field' | 'fromValue' | 'toValue'>,
): string {
  const simple = SIMPLE_FIELD_COPY[row.field];
  if (simple !== undefined) return simple;
  if (row.field === 'priority') return `set priority to ${describePriority(row.toValue)}`;
  if (row.field === 'assignee')
    return (
      FIELD_RENDERERS['assignee']?.({
        from: assigneeNameOf(row.fromValue),
        to: assigneeNameOf(row.toValue),
      }) ?? 'changed the assignee'
    );

  const change: RenderedChange = { from: nameOf(row.fromValue), to: nameOf(row.toValue) };
  const render = FIELD_RENDERERS[row.field];
  if (render !== undefined) return render(change);

  if (change.from === null && change.to === null) return `changed ${row.field}`;
  if (change.from === null) return `set ${row.field} to ${change.to}`;
  if (change.to === null) return `cleared ${row.field}`;
  return `changed ${row.field} from ${change.from} to ${change.to}`;
}
