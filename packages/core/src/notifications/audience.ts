import { and, eq, inArray, schema } from '@orbit/db';
import {
  isRestricted,
  type NotificationReason,
  type NotificationType,
} from '@orbit/shared/constants';
import { unique } from '@orbit/shared/utils';
import type { Executor } from '../internal.ts';

export interface AudienceGroup {
  readonly type: NotificationType;
  readonly reason: NotificationReason;
  readonly userIds: readonly string[];
}

export interface ReadableDoc {
  readonly id: string;
  readonly organizationId: string;
  readonly authorId: string;
  readonly visibility: string;
}

async function organizationMembers(
  executor: Executor,
  organizationId: string,
  candidates: readonly string[],
): Promise<{ userId: string; role: string }[]> {
  return await executor
    .select({ userId: schema.member.userId, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        inArray(schema.member.userId, [...candidates]),
      ),
    );
}

export async function docReaderIds(
  executor: Executor,
  doc: ReadableDoc,
  userIds: readonly string[],
): Promise<Set<string>> {
  const candidates = unique(userIds);
  if (candidates.length === 0) return new Set();
  const members = await organizationMembers(executor, doc.organizationId, candidates);
  if (!isRestricted(doc.visibility)) return new Set(members.map((row) => row.userId));

  const [userGrants, teamGrants] = await Promise.all([
    executor
      .select({ userId: schema.docAccess.subjectId })
      .from(schema.docAccess)
      .where(
        and(
          eq(schema.docAccess.docId, doc.id),
          eq(schema.docAccess.subjectType, 'user'),
          inArray(schema.docAccess.subjectId, [...candidates]),
        ),
      ),
    executor
      .select({ userId: schema.teamMember.userId })
      .from(schema.teamMember)
      .innerJoin(
        schema.docAccess,
        and(
          eq(schema.docAccess.subjectId, schema.teamMember.teamId),
          eq(schema.docAccess.subjectType, 'team'),
          eq(schema.docAccess.docId, doc.id),
        ),
      )
      .where(inArray(schema.teamMember.userId, [...candidates])),
  ]);

  const readers = new Set<string>();
  for (const row of members) {
    if (row.role === 'admin' || row.userId === doc.authorId) readers.add(row.userId);
  }
  const memberIds = new Set(members.map((row) => row.userId));
  for (const row of [...userGrants, ...teamGrants]) {
    if (memberIds.has(row.userId)) readers.add(row.userId);
  }
  return readers;
}

export async function teamReaderIds(
  executor: Executor,
  organizationId: string,
  teamId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const candidates = unique(userIds);
  if (candidates.length === 0) return new Set();
  const [members, onTeam] = await Promise.all([
    organizationMembers(executor, organizationId, candidates),
    executor
      .select({ userId: schema.teamMember.userId })
      .from(schema.teamMember)
      .where(
        and(eq(schema.teamMember.teamId, teamId), inArray(schema.teamMember.userId, candidates)),
      ),
  ]);
  const onTeamIds = new Set(onTeam.map((row) => row.userId));
  const readers = new Set<string>();
  for (const row of members) {
    if (row.role === 'admin' || onTeamIds.has(row.userId)) readers.add(row.userId);
  }
  return readers;
}

export function restrictAudience<T extends AudienceGroup>(
  groups: readonly T[],
  readers: ReadonlySet<string>,
): T[] {
  const result: T[] = [];
  for (const group of groups) {
    const userIds = group.userIds.filter((id) => readers.has(id));
    if (userIds.length > 0) result.push({ ...group, userIds });
  }
  return result;
}

export function dedupeAudience<T extends AudienceGroup>(
  groups: readonly T[],
  excluded: readonly (string | null)[] = [],
): T[] {
  const claimed = new Set(excluded.filter((id): id is string => id !== null));
  const result: T[] = [];
  for (const group of groups) {
    const userIds = unique(group.userIds).filter((id) => !claimed.has(id));
    if (userIds.length === 0) continue;
    for (const id of userIds) claimed.add(id);
    result.push({ ...group, userIds });
  }
  return result;
}
