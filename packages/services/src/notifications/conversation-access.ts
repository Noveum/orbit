import { and, eq, inArray, isNull, schema, sql, type Transaction } from '@orbit/db';
import { isRestricted } from '@orbit/shared/constants';
import {
  canReadDoc,
  isInOrganization,
  isInTeam,
  type Principal,
  policyRole,
} from '@orbit/shared/policy';
import { ensureAndLockInboxStates, refreshInboxStates } from './compatibility.ts';

export interface NotificationSubjectAccessInput {
  readonly organizationId: string;
  readonly subjectType: string;
  readonly subjectId?: string;
  readonly subjectKey?: string;
  readonly userId?: string;
  readonly teamId?: string | null;
}

async function lockRecipient(
  tx: Transaction,
  input: NotificationSubjectAccessInput,
): Promise<Principal | null> {
  if (input.userId === undefined) return null;
  const [membership] = await tx
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, input.organizationId),
        eq(schema.member.userId, input.userId),
      ),
    )
    .orderBy(schema.member.id)
    .for('share');
  if (membership === undefined) return null;
  const teams = await tx
    .select({ teamId: schema.teamMember.teamId })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
    .where(
      and(
        eq(schema.team.organizationId, input.organizationId),
        eq(schema.teamMember.userId, input.userId),
      ),
    )
    .orderBy(schema.teamMember.teamId)
    .for('share');
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    role: policyRole(membership.role),
    teamIds: teams.map((row) => row.teamId),
  };
}

function permitsTeams(
  input: NotificationSubjectAccessInput,
  principal: Principal | null,
  teamIds: readonly string[],
): boolean {
  if (input.userId !== undefined) {
    return (
      principal !== null &&
      (teamIds.length === 0
        ? isInOrganization(principal, input.organizationId)
        : teamIds.some((id) => isInTeam(principal, { id, organizationId: input.organizationId })))
    );
  }
  return teamIds.length === 0 || (input.teamId != null && teamIds.includes(input.teamId));
}

function canonicalSubjectId(input: NotificationSubjectAccessInput): string | undefined {
  if (input.subjectId !== undefined) return input.subjectId;
  return /^orbit-(?:issue|doc|project):([^:]+):(?:activity|status)$/.exec(
    input.subjectKey ?? '',
  )?.[1];
}

export async function lockNotificationSubjectAccess(
  tx: Transaction,
  input: NotificationSubjectAccessInput,
): Promise<boolean> {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${`notification-policy:${input.organizationId}`}, 0))`,
  );
  const [organization] = await tx
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(
      and(
        eq(schema.organization.id, input.organizationId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .for('share');
  if (organization === undefined) return false;
  const subjectId = canonicalSubjectId(input);
  if (input.subjectType === 'legacy_notification' && subjectId !== undefined) {
    const [event] = await tx
      .select({
        entityType: schema.notification.entityType,
        entityId: schema.notification.entityId,
        userId: schema.notification.userId,
      })
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.id, subjectId),
          eq(schema.notification.organizationId, input.organizationId),
        ),
      );
    if (
      event === undefined ||
      event.entityType === 'legacy_notification' ||
      input.userId !== event.userId
    )
      return false;
    return await lockNotificationSubjectAccess(tx, {
      ...input,
      subjectType: event.entityType,
      subjectId: event.entityId,
    });
  }
  if (input.subjectType === 'doc_comment' && subjectId !== undefined) {
    const [comment] = await tx
      .select({ docId: schema.docComment.docId })
      .from(schema.docComment)
      .where(
        and(
          eq(schema.docComment.id, subjectId),
          eq(schema.docComment.organizationId, input.organizationId),
        ),
      )
      .for('share');
    return (
      comment !== undefined &&
      (await lockNotificationSubjectAccess(tx, {
        ...input,
        subjectType: 'doc',
        subjectId: comment.docId,
      }))
    );
  }
  if (input.subjectType === 'doc' && subjectId !== undefined)
    return await lockDocumentAccess(tx, input, subjectId);
  const teams = await lockSubjectTeams(tx, input, subjectId);
  return teams !== null && permitsTeams(input, await lockRecipient(tx, input), teams);
}

async function lockDocumentAccess(
  tx: Transaction,
  input: NotificationSubjectAccessInput,
  subjectId: string,
): Promise<boolean> {
  const [doc] = await tx
    .select()
    .from(schema.doc)
    .where(and(eq(schema.doc.id, subjectId), eq(schema.doc.organizationId, input.organizationId)))
    .for('share');
  if (doc === undefined) return false;
  const grants = await tx
    .select()
    .from(schema.docAccess)
    .where(
      and(
        eq(schema.docAccess.docId, doc.id),
        eq(schema.docAccess.organizationId, input.organizationId),
      ),
    )
    .orderBy(schema.docAccess.id)
    .for('share');
  const principal = await lockRecipient(tx, input);
  if (input.userId === undefined) {
    return (
      !isRestricted(doc.visibility) ||
      (input.teamId != null &&
        grants.some((grant) => grant.subjectType === 'team' && grant.subjectId === input.teamId))
    );
  }
  if (principal === null) return false;
  const granted = grants.some(
    (grant) =>
      (grant.subjectType === 'user' && grant.subjectId === principal.userId) ||
      (grant.subjectType === 'team' && principal.teamIds.includes(grant.subjectId)),
  );
  return canReadDoc(principal, doc, granted ? [doc.id] : []);
}

async function lockSubjectTeams(
  tx: Transaction,
  input: NotificationSubjectAccessInput,
  subjectId: string | undefined,
): Promise<string[] | null> {
  let teamIds: string[];
  if ((input.subjectType === 'issue' || input.subjectType === 'task') && subjectId !== undefined) {
    const [issue] = await tx
      .select({ teamId: schema.issue.teamId })
      .from(schema.issue)
      .where(
        and(eq(schema.issue.id, subjectId), eq(schema.issue.organizationId, input.organizationId)),
      )
      .for('share');
    if (issue === undefined) return null;
    teamIds = [issue.teamId];
  } else if (input.subjectType === 'project' && subjectId !== undefined) {
    const [project] = await tx
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.id, subjectId),
          eq(schema.project.organizationId, input.organizationId),
        ),
      )
      .for('share');
    if (project === undefined) return null;
    const teams = await tx
      .select({ teamId: schema.projectTeam.teamId })
      .from(schema.projectTeam)
      .where(eq(schema.projectTeam.projectId, project.id))
      .orderBy(schema.projectTeam.teamId)
      .for('share');
    teamIds = teams.map((row) => row.teamId);
  } else if (input.subjectType === 'github_pull_request') {
    return await lockPullRequestTeams(tx, input, subjectId);
  } else if (input.subjectType === 'invitation' || input.subjectType === 'membership') {
    if (input.userId === undefined) return null;
    teamIds = [];
  } else return null;
  return teamIds;
}

async function lockPullRequestTeams(
  tx: Transaction,
  input: NotificationSubjectAccessInput,
  subjectId: string | undefined,
): Promise<string[] | null> {
  const key = /^github-pr:([^:]+):([1-9]\d*)$/.exec(input.subjectKey ?? '');
  const repositoryId = key?.[1];
  const number = Number(key?.[2]);
  if (subjectId === undefined && (repositoryId === undefined || !Number.isSafeInteger(number)))
    return null;
  const [pull] = await tx
    .select({ teamId: schema.githubRepositorySync.teamId })
    .from(schema.githubPullRequest)
    .innerJoin(
      schema.githubRepositorySync,
      and(
        eq(schema.githubRepositorySync.id, schema.githubPullRequest.repositorySyncId),
        eq(schema.githubRepositorySync.organizationId, schema.githubPullRequest.organizationId),
        eq(schema.githubRepositorySync.repositoryId, schema.githubPullRequest.repositoryId),
      ),
    )
    .where(
      and(
        eq(schema.githubPullRequest.organizationId, input.organizationId),
        subjectId === undefined
          ? and(
              eq(schema.githubPullRequest.repositoryId, repositoryId ?? ''),
              eq(schema.githubPullRequest.number, number),
            )
          : eq(schema.githubPullRequest.id, subjectId),
      ),
    )
    .for('share');
  if (pull === undefined) return null;
  return pull.teamId === null ? [] : [pull.teamId];
}

export async function refreshNotificationConversationAccess(
  tx: Transaction,
  organizationId: string,
  userId: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await tx
    .select({
      id: schema.notificationConversation.id,
      subjectType: schema.notificationConversation.subjectType,
      subjectId: schema.notificationConversation.subjectId,
      accessHiddenAt: schema.notificationConversation.accessHiddenAt,
    })
    .from(schema.notificationConversation)
    .where(
      and(
        eq(schema.notificationConversation.organizationId, organizationId),
        eq(schema.notificationConversation.userId, userId),
      ),
    )
    .orderBy(
      schema.notificationConversation.subjectType,
      schema.notificationConversation.subjectId,
      schema.notificationConversation.id,
    );
  const accessible = await batchConversationAccess(tx, organizationId, userId, rows);
  await ensureAndLockInboxStates(tx, [{ organizationId, userId }], now);
  const changed: string[] = [];
  for (const allowed of [false, true]) {
    const ids = rows
      .filter(
        (row) => accessible.get(row.id) === allowed && (row.accessHiddenAt === null) !== allowed,
      )
      .map((row) => row.id);
    if (ids.length === 0) continue;
    const updates = await tx
      .update(schema.notificationConversation)
      .set({
        accessHiddenAt: allowed ? null : now,
        accessGeneration: sql`${schema.notificationConversation.accessGeneration} + 1`,
        syncId: sql`nextval('sync_id_seq')`,
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.notificationConversation.id, ids),
          allowed
            ? sql`${schema.notificationConversation.accessHiddenAt} is not null`
            : isNull(schema.notificationConversation.accessHiddenAt),
        ),
      )
      .returning({ id: schema.notificationConversation.id });
    changed.push(...updates.map((update) => update.id));
  }
  await refreshInboxStates(tx, [{ organizationId, userId }], now);
  return changed;
}

type AccessConversation = Pick<
  typeof schema.notificationConversation.$inferSelect,
  'id' | 'subjectType' | 'subjectId' | 'accessHiddenAt'
>;
type AccessSubject = Pick<AccessConversation, 'id' | 'subjectType' | 'subjectId'>;

async function normalizedSubjects(
  tx: Transaction,
  organizationId: string,
  userId: string,
  rows: readonly AccessConversation[],
): Promise<AccessSubject[]> {
  const legacyIds = rows
    .filter((row) => row.subjectType === 'legacy_notification')
    .map((row) => row.subjectId);
  const legacy =
    legacyIds.length === 0
      ? []
      : await tx
          .select({
            id: schema.notification.id,
            subjectType: schema.notification.entityType,
            subjectId: schema.notification.entityId,
          })
          .from(schema.notification)
          .where(
            and(
              eq(schema.notification.organizationId, organizationId),
              eq(schema.notification.userId, userId),
              inArray(schema.notification.id, legacyIds),
            ),
          );
  const legacyById = new Map(legacy.map((row) => [row.id, row]));
  const resolved = rows.map((row) => {
    const source = row.subjectType === 'legacy_notification' ? legacyById.get(row.subjectId) : row;
    return {
      id: row.id,
      subjectType: source?.subjectType ?? '',
      subjectId: source?.subjectId ?? '',
    };
  });
  const commentIds = resolved
    .filter((row) => row.subjectType === 'doc_comment')
    .map((row) => row.subjectId);
  const comments =
    commentIds.length === 0
      ? []
      : await tx
          .select({
            id: schema.docComment.id,
            docId: schema.docComment.docId,
          })
          .from(schema.docComment)
          .where(
            and(
              eq(schema.docComment.organizationId, organizationId),
              inArray(schema.docComment.id, commentIds),
            ),
          )
          .orderBy(schema.docComment.id)
          .for('share');
  const docs = new Map(comments.map((row) => [row.id, row.docId]));
  return resolved.map((row) => {
    if (row.subjectType === 'task') return { ...row, subjectType: 'issue' };
    if (row.subjectType !== 'doc_comment') return row;
    return { ...row, subjectType: 'doc', subjectId: docs.get(row.subjectId) ?? '' };
  });
}

async function lockBatchSubjects(
  tx: Transaction,
  organizationId: string,
  rows: readonly AccessSubject[],
) {
  const idsFor = (type: string) =>
    [...new Set(rows.filter((row) => row.subjectType === type).map((row) => row.subjectId))].sort();
  const docIds = idsFor('doc');
  const issueIds = idsFor('issue');
  const projectIds = idsFor('project');
  const pullIds = idsFor('github_pull_request');
  const docs =
    docIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.doc)
          .where(and(eq(schema.doc.organizationId, organizationId), inArray(schema.doc.id, docIds)))
          .orderBy(schema.doc.id)
          .for('share');
  const pulls =
    pullIds.length === 0
      ? []
      : await tx
          .select({ id: schema.githubPullRequest.id, teamId: schema.githubRepositorySync.teamId })
          .from(schema.githubPullRequest)
          .innerJoin(
            schema.githubRepositorySync,
            and(
              eq(schema.githubRepositorySync.id, schema.githubPullRequest.repositorySyncId),
              eq(schema.githubRepositorySync.organizationId, organizationId),
              eq(schema.githubRepositorySync.repositoryId, schema.githubPullRequest.repositoryId),
            ),
          )
          .where(
            and(
              eq(schema.githubPullRequest.organizationId, organizationId),
              inArray(schema.githubPullRequest.id, pullIds),
            ),
          )
          .orderBy(schema.githubPullRequest.id)
          .for('share');
  const issues =
    issueIds.length === 0
      ? []
      : await tx
          .select({ id: schema.issue.id, teamId: schema.issue.teamId })
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.organizationId, organizationId),
              inArray(schema.issue.id, issueIds),
            ),
          )
          .orderBy(schema.issue.id)
          .for('share');
  const projects =
    projectIds.length === 0
      ? []
      : await tx
          .select({ id: schema.project.id })
          .from(schema.project)
          .where(
            and(
              eq(schema.project.organizationId, organizationId),
              inArray(schema.project.id, projectIds),
            ),
          )
          .orderBy(schema.project.id)
          .for('share');
  const grants =
    docIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.docAccess)
          .where(
            and(
              eq(schema.docAccess.organizationId, organizationId),
              inArray(schema.docAccess.docId, docIds),
            ),
          )
          .orderBy(schema.docAccess.id)
          .for('share');
  const teams =
    projectIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.projectTeam)
          .where(inArray(schema.projectTeam.projectId, projectIds))
          .orderBy(schema.projectTeam.id)
          .for('share');
  return { docs, pulls, issues, projects, grants, teams };
}

function evaluateBatchSubjects(
  subjects: Awaited<ReturnType<typeof lockBatchSubjects>>,
  principal: Principal,
): Map<string, boolean> {
  const { docs, pulls, issues, projects, grants, teams } = subjects;
  const { organizationId, userId } = principal;
  const bySubject = new Map<string, boolean>();
  for (const doc of docs) {
    const allowed = grants.some(
      (grant) =>
        grant.docId === doc.id &&
        ((grant.subjectType === 'user' && grant.subjectId === userId) ||
          (grant.subjectType === 'team' && principal.teamIds.includes(grant.subjectId))),
    );
    bySubject.set(`doc:${doc.id}`, canReadDoc(principal, doc, allowed ? [doc.id] : []));
  }
  for (const issue of issues)
    bySubject.set(`issue:${issue.id}`, isInTeam(principal, { id: issue.teamId, organizationId }));
  for (const pull of pulls)
    bySubject.set(
      `github_pull_request:${pull.id}`,
      pull.teamId === null || isInTeam(principal, { id: pull.teamId, organizationId }),
    );
  for (const project of projects) {
    const owning = teams.filter((row) => row.projectId === project.id).map((row) => row.teamId);
    bySubject.set(
      `project:${project.id}`,
      permitsTeams({ organizationId, subjectType: 'project', userId }, principal, owning),
    );
  }
  return bySubject;
}

async function batchConversationAccess(
  tx: Transaction,
  organizationId: string,
  userId: string,
  rows: readonly AccessConversation[],
): Promise<Map<string, boolean>> {
  if (rows.length === 0) return new Map();
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${`notification-policy:${organizationId}`}, 0))`,
  );
  const [organization] = await tx
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(
      and(
        eq(schema.organization.id, organizationId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .for('share');
  if (organization === undefined) return new Map(rows.map((row) => [row.id, false]));
  const normalized = await normalizedSubjects(tx, organizationId, userId, rows);
  const subjects = await lockBatchSubjects(tx, organizationId, normalized);
  const principal = await lockRecipient(tx, { organizationId, subjectType: '', userId });
  if (principal === null) return new Map(rows.map((row) => [row.id, false]));
  const bySubject = evaluateBatchSubjects(subjects, principal);
  return new Map(
    normalized.map((row) => [
      row.id,
      row.subjectType === 'invitation' ||
        row.subjectType === 'membership' ||
        (bySubject.get(`${row.subjectType}:${row.subjectId}`) ?? false),
    ]),
  );
}
