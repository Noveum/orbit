import { and, asc, db, eq, gt, inArray, schema, sql } from '@orbit/db';
import type { SyncAction, SyncModel } from '@orbit/shared/events';
import { CATCHUP_LIMIT, scopes } from '@orbit/shared/events';
import { assertCan, can, type Principal } from '@orbit/shared/policy';
import { docReadFilter } from '../content/doc-service.ts';
import { inviteAnnouncement, inviteReference } from '../org/invite-service.ts';
import { viewReadFilter, viewScopes } from '../work/view-service.ts';
import { buildSyncAction } from './publisher.ts';

export interface SyncCatchupResult {
  readonly syncId: number;
  readonly actions: SyncAction[];
  readonly truncated: boolean;
}

interface BackfilledRow {
  readonly modelId: string;
  readonly syncId: number;
  readonly scopes: string[];
  readonly data: Record<string, unknown>;
}

type Loader = (principal: Principal, since: number, limit: number) => Promise<BackfilledRow[]>;

const CATCHUP_ACTOR = { type: 'system', id: 'sync', name: 'Catch up' } as const;

type AttachmentParent = {
  readonly id: string;
  readonly parentType: string;
  readonly parentId: string;
};

function withoutBody<T extends { content: string }>(row: T): Omit<T, 'content'> {
  const { content: _body, ...rest } = row;
  return rest;
}

async function readableDocIds(
  principal: Principal,
  docIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.doc.id })
    .from(schema.doc)
    .where(and(inArray(schema.doc.id, ids), docReadFilter(principal)));
  return new Set(rows.map((row) => row.id));
}

async function issueTeamsById(issueIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(issueIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.issue.id, teamId: schema.issue.teamId })
    .from(schema.issue)
    .where(inArray(schema.issue.id, ids));
  return new Map(rows.map((row) => [row.id, row.teamId]));
}

async function labelsForIssues(issueIds: readonly string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const ids = [...new Set(issueIds)];
  if (ids.length === 0) return grouped;
  const rows = await db
    .select({ issueId: schema.issueLabel.issueId, labelId: schema.issueLabel.labelId })
    .from(schema.issueLabel)
    .where(inArray(schema.issueLabel.issueId, ids));
  for (const row of rows) {
    const existing = grouped.get(row.issueId);
    if (existing === undefined) grouped.set(row.issueId, [row.labelId]);
    else existing.push(row.labelId);
  }
  return grouped;
}

async function commentTeamsById(commentIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(commentIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.comment.id, teamId: schema.issue.teamId })
    .from(schema.comment)
    .innerJoin(schema.issue, eq(schema.issue.id, schema.comment.issueId))
    .where(inArray(schema.comment.id, ids));
  return new Map(rows.map((row) => [row.id, row.teamId]));
}

async function teamsByAttachmentParent(
  rows: readonly AttachmentParent[],
): Promise<Map<string, string[]>> {
  const of = (type: string) => rows.filter((row) => row.parentType === type);
  const issueParents = of('issue');
  const commentParents = of('comment');
  const projectParents = of('project');

  const [issueTeams, commentTeams, projectTeams] = await Promise.all([
    issueTeamsById(issueParents.map((row) => row.parentId)),
    commentTeamsById(commentParents.map((row) => row.parentId)),
    teamsByProject(projectParents.map((row) => row.parentId)),
  ]);

  const byAttachment = new Map<string, string[]>();
  for (const row of issueParents) {
    const teamId = issueTeams.get(row.parentId);
    if (teamId !== undefined) byAttachment.set(row.id, [teamId]);
  }
  for (const row of commentParents) {
    const teamId = commentTeams.get(row.parentId);
    if (teamId !== undefined) byAttachment.set(row.id, [teamId]);
  }
  for (const row of projectParents) {
    const found = projectTeams.get(row.parentId) ?? [];
    if (found.length > 0) byAttachment.set(row.id, found);
  }
  return byAttachment;
}

async function teamsByProject(
  projectIds: readonly (string | null)[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(projectIds.filter((id): id is string => id !== null))];
  const byProject = new Map<string, string[]>();
  if (ids.length === 0) return byProject;
  const rows = await db
    .select({ projectId: schema.projectTeam.projectId, teamId: schema.projectTeam.teamId })
    .from(schema.projectTeam)
    .where(inArray(schema.projectTeam.projectId, ids));
  for (const row of rows) {
    const bucket = byProject.get(row.projectId) ?? [];
    bucket.push(row.teamId);
    byProject.set(row.projectId, bucket);
  }
  return byProject;
}

const LOADERS: Record<SyncModel, Loader> = {
  organization: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.organization)
        .where(
          and(
            eq(schema.organization.id, principal.organizationId),
            gt(schema.organization.syncId, since),
          ),
        )
        .orderBy(asc(schema.organization.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.id)],
      data: row,
    })),

  member: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, principal.organizationId),
            gt(schema.member.syncId, since),
          ),
        )
        .orderBy(asc(schema.member.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.user(row.userId)],
      data: row,
    })),

  invitation: async (principal, since, limit) =>
    can(principal, 'member:invite')
      ? (
          await db
            .select()
            .from(schema.invitation)
            .where(
              and(
                eq(schema.invitation.organizationId, principal.organizationId),
                gt(schema.invitation.syncId, since),
              ),
            )
            .orderBy(asc(schema.invitation.syncId))
            .limit(limit)
        ).map((row) => ({
          modelId: inviteReference(row.id),
          syncId: row.syncId,
          scopes: [scopes.organization(row.organizationId)],
          data: inviteAnnouncement(row),
        }))
      : [],

  team: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.team)
        .where(
          and(
            eq(schema.team.organizationId, principal.organizationId),
            gt(schema.team.syncId, since),
          ),
        )
        .orderBy(asc(schema.team.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.team(row.id)],
      data: row,
    })),

  team_member: async (principal, since, limit) =>
    (
      await db
        .select({ row: schema.teamMember })
        .from(schema.teamMember)
        .innerJoin(schema.team, eq(schema.team.id, schema.teamMember.teamId))
        .where(
          and(
            eq(schema.team.organizationId, principal.organizationId),
            gt(schema.teamMember.syncId, since),
          ),
        )
        .orderBy(asc(schema.teamMember.syncId))
        .limit(limit)
    ).map(({ row }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.team(row.teamId), scopes.user(row.userId)],
      data: row,
    })),

  workflow_state: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.workflowState)
        .where(
          and(
            eq(schema.workflowState.organizationId, principal.organizationId),
            gt(schema.workflowState.syncId, since),
          ),
        )
        .orderBy(asc(schema.workflowState.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.team(row.teamId)],
      data: row,
    })),

  label: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.label)
        .where(
          and(
            eq(schema.label.organizationId, principal.organizationId),
            gt(schema.label.syncId, since),
          ),
        )
        .orderBy(asc(schema.label.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes:
        row.teamId === null
          ? [scopes.organization(row.organizationId)]
          : [scopes.organization(row.organizationId), scopes.team(row.teamId)],
      data: row,
    })),

  project: async (principal, since, limit) => {
    const rows = await db
      .select()
      .from(schema.project)
      .where(
        and(
          eq(schema.project.organizationId, principal.organizationId),
          gt(schema.project.syncId, since),
        ),
      )
      .orderBy(asc(schema.project.syncId))
      .limit(limit);
    const teams = await teamsByProject(rows.map((row) => row.id));
    return rows.map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.organization(row.organizationId),
        scopes.project(row.id),
        ...(teams.get(row.id) ?? []).map(scopes.team),
      ],
      data: row,
    }));
  },

  milestone: async (principal, since, limit) => {
    const rows = await db
      .select()
      .from(schema.milestone)
      .where(
        and(
          eq(schema.milestone.organizationId, principal.organizationId),
          gt(schema.milestone.syncId, since),
        ),
      )
      .orderBy(asc(schema.milestone.syncId))
      .limit(limit);
    const teams = await teamsByProject(rows.map((row) => row.projectId));
    return rows.map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.organization(row.organizationId),
        scopes.project(row.projectId),
        ...(teams.get(row.projectId) ?? []).map(scopes.team),
      ],
      data: row,
    }));
  },

  cycle: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.cycle)
        .where(
          and(
            eq(schema.cycle.organizationId, principal.organizationId),
            gt(schema.cycle.syncId, since),
          ),
        )
        .orderBy(asc(schema.cycle.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.team(row.teamId)],
      data: row,
    })),

  issue: async (principal, since, limit) => {
    const rows = await db
      .select()
      .from(schema.issue)
      .where(
        and(
          eq(schema.issue.organizationId, principal.organizationId),
          gt(schema.issue.syncId, since),
        ),
      )
      .orderBy(asc(schema.issue.syncId))
      .limit(limit);
    const labels = await labelsForIssues(rows.map((row) => row.id));
    return rows.map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes:
        row.projectId === null
          ? [scopes.organization(row.organizationId), scopes.team(row.teamId), scopes.issue(row.id)]
          : [
              scopes.organization(row.organizationId),
              scopes.team(row.teamId),
              scopes.issue(row.id),
              scopes.project(row.projectId),
            ],
      data: { ...row, labelIds: labels.get(row.id) ?? [] },
    }));
  },

  issue_relation: async (principal, since, limit) =>
    (
      await db
        .select({ row: schema.issueRelation, teamId: schema.issue.teamId })
        .from(schema.issueRelation)
        .innerJoin(schema.issue, eq(schema.issue.id, schema.issueRelation.issueId))
        .where(
          and(
            eq(schema.issueRelation.organizationId, principal.organizationId),
            gt(schema.issueRelation.syncId, since),
          ),
        )
        .orderBy(asc(schema.issueRelation.syncId))
        .limit(limit)
    ).map(({ row, teamId }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.organization(row.organizationId),
        scopes.team(teamId),
        scopes.issue(row.issueId),
        scopes.issue(row.relatedIssueId),
      ],
      data: row,
    })),

  issue_subscription: async (principal, since, limit) =>
    (
      await db
        .select({ row: schema.issueSubscription })
        .from(schema.issueSubscription)
        .innerJoin(schema.issue, eq(schema.issue.id, schema.issueSubscription.issueId))
        .where(
          and(
            eq(schema.issue.organizationId, principal.organizationId),
            eq(schema.issueSubscription.userId, principal.userId),
            gt(schema.issueSubscription.syncId, since),
          ),
        )
        .orderBy(asc(schema.issueSubscription.syncId))
        .limit(limit)
    ).map(({ row }) => ({
      modelId: `${row.issueId}:${row.userId}`,
      syncId: row.syncId,
      scopes: [scopes.issue(row.issueId), scopes.user(row.userId)],
      data: row,
    })),

  comment: async (principal, since, limit) =>
    (
      await db
        .select({ row: schema.comment, teamId: schema.issue.teamId })
        .from(schema.comment)
        .innerJoin(schema.issue, eq(schema.issue.id, schema.comment.issueId))
        .where(
          and(
            eq(schema.comment.organizationId, principal.organizationId),
            gt(schema.comment.syncId, since),
          ),
        )
        .orderBy(asc(schema.comment.syncId))
        .limit(limit)
    ).map(({ row, teamId }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.organization(row.organizationId),
        scopes.team(teamId),
        scopes.issue(row.issueId),
      ],
      data: row,
    })),

  doc_comment: async (principal, since, limit) =>
    (
      await db
        .select({ row: schema.docComment })
        .from(schema.docComment)
        .innerJoin(schema.doc, eq(schema.doc.id, schema.docComment.docId))
        .where(
          and(
            eq(schema.docComment.organizationId, principal.organizationId),
            docReadFilter(principal),
            gt(schema.docComment.syncId, since),
          ),
        )
        .orderBy(asc(schema.docComment.syncId))
        .limit(limit)
    ).map(({ row }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.doc(row.docId)],
      data: row,
    })),

  reaction: async (principal, since, limit) =>
    (
      await db
        .select({
          row: schema.reaction,
          teamId: schema.issue.teamId,
          issueId: schema.issue.id,
        })
        .from(schema.reaction)
        .leftJoin(schema.comment, eq(schema.comment.id, schema.reaction.commentId))
        .innerJoin(
          schema.issue,
          eq(schema.issue.id, sql`coalesce(${schema.comment.issueId}, ${schema.reaction.issueId})`),
        )
        .where(
          and(
            eq(schema.reaction.organizationId, principal.organizationId),
            gt(schema.reaction.syncId, since),
          ),
        )
        .orderBy(asc(schema.reaction.syncId))
        .limit(limit)
    ).map(({ row, teamId, issueId }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.team(teamId), scopes.issue(issueId)],
      data: row,
    })),

  attachment: async (principal, since, limit) => {
    const rows = await db
      .select()
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.organizationId, principal.organizationId),
          gt(schema.attachment.syncId, since),
        ),
      )
      .orderBy(asc(schema.attachment.syncId))
      .limit(limit);
    const teams = await teamsByAttachmentParent(rows);
    const readableDocs = await readableDocIds(
      principal,
      rows.filter((row) => row.parentType === 'doc').map((row) => row.parentId),
    );
    return rows
      .filter((row) => row.parentType !== 'doc' || readableDocs.has(row.parentId))
      .map((row) => ({
        modelId: row.id,
        syncId: row.syncId,
        scopes:
          row.parentType === 'doc'
            ? [scopes.organization(row.organizationId), scopes.doc(row.parentId)]
            : [
                scopes.organization(row.organizationId),
                scopes.issue(row.parentId),
                ...(teams.get(row.id) ?? []).map(scopes.team),
              ],
        data: row,
      }));
  },

  doc: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.doc)
        .where(
          and(
            eq(schema.doc.organizationId, principal.organizationId),
            docReadFilter(principal),
            gt(schema.doc.syncId, since),
          ),
        )
        .orderBy(asc(schema.doc.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes:
        row.projectId === null
          ? [scopes.organization(row.organizationId), scopes.doc(row.id)]
          : [
              scopes.organization(row.organizationId),
              scopes.doc(row.id),
              scopes.project(row.projectId),
            ],
      data: { ...withoutBody(row), publishToken: row.publishToken === null ? null : 'redacted' },
    })),

  doc_collection: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.docCollection)
        .where(
          and(
            eq(schema.docCollection.organizationId, principal.organizationId),
            gt(schema.docCollection.syncId, since),
          ),
        )
        .orderBy(asc(schema.docCollection.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId)],
      data: row,
    })),

  notification: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.organizationId, principal.organizationId),
            eq(schema.notification.userId, principal.userId),
            gt(schema.notification.syncId, since),
          ),
        )
        .orderBy(asc(schema.notification.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.user(row.userId)],
      data: row,
    })),

  view: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.view)
        .where(
          and(
            eq(schema.view.organizationId, principal.organizationId),
            viewReadFilter(principal),
            gt(schema.view.syncId, since),
          ),
        )
        .orderBy(asc(schema.view.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: viewScopes(row),
      data: row,
    })),

  git_link: async (principal, since, limit) =>
    (
      await db
        .select({
          row: schema.gitLink,
          teamId: schema.issue.teamId,
          creatorId: schema.issue.creatorId,
          assigneeId: schema.issue.assigneeId,
        })
        .from(schema.gitLink)
        .innerJoin(schema.issue, eq(schema.issue.id, schema.gitLink.issueId))
        .where(
          and(
            eq(schema.gitLink.organizationId, principal.organizationId),
            gt(schema.gitLink.syncId, since),
          ),
        )
        .orderBy(asc(schema.gitLink.syncId))
        .limit(limit)
    ).map(({ row, teamId, creatorId, assigneeId }) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.issue(row.issueId),
        scopes.team(teamId),
        scopes.user(creatorId),
        ...(assigneeId === null ? [] : [scopes.user(assigneeId)]),
      ],
      data: row,
    })),

  standup: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.standup)
        .where(
          and(
            eq(schema.standup.organizationId, principal.organizationId),
            gt(schema.standup.syncId, since),
          ),
        )
        .orderBy(asc(schema.standup.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.team(row.teamId)],
      data: row,
    })),
  standup_rotation: async (principal, since, limit) => {
    const touched = await db
      .select({
        teamId: schema.standupRotation.teamId,
        syncId: sql<number>`min(${schema.standupRotation.syncId})`.as('sync_id'),
      })
      .from(schema.standupRotation)
      .where(
        and(
          eq(schema.standupRotation.organizationId, principal.organizationId),
          gt(schema.standupRotation.syncId, since),
        ),
      )
      .groupBy(schema.standupRotation.teamId)
      .orderBy(asc(sql`min(${schema.standupRotation.syncId})`))
      .limit(limit);
    if (touched.length === 0) return [];

    const rows = await db
      .select()
      .from(schema.standupRotation)
      .where(
        and(
          eq(schema.standupRotation.organizationId, principal.organizationId),
          inArray(
            schema.standupRotation.teamId,
            touched.map((entry) => entry.teamId),
          ),
        ),
      )
      .orderBy(asc(schema.standupRotation.position));

    return touched.map(({ teamId, syncId }) => {
      const rotation = rows.filter((row) => row.teamId === teamId);
      return {
        modelId: teamId,
        syncId,
        scopes: [scopes.team(teamId)],
        data: { teamId, rotation },
      };
    });
  },
};

export const SYNC_CATCHUP_MODELS = Object.keys(LOADERS) as SyncModel[];

const TEAM_SCOPE_PREFIX = 'team:';

export function visibleToPrincipal(principal: Principal, rowScopes: readonly string[]): boolean {
  if (principal.role === 'admin') return true;
  const teamScopes = rowScopes.filter((scope) => scope.startsWith(TEAM_SCOPE_PREFIX));
  if (teamScopes.length === 0) return true;
  return teamScopes.some((scope) =>
    principal.teamIds.includes(scope.slice(TEAM_SCOPE_PREFIX.length)),
  );
}

export async function catchUp(
  principal: Principal,
  since: number,
  limit = CATCHUP_LIMIT,
): Promise<SyncCatchupResult> {
  assertCan(principal, 'issue:read');
  const perModel = Math.max(1, limit);
  const loaded: { model: SyncModel; rows: BackfilledRow[] }[] = [];
  for (const model of SYNC_CATCHUP_MODELS) {
    loaded.push({ model, rows: await LOADERS[model](principal, since, perModel + 1) });
  }

  const all: SyncAction[] = [];
  let saturated = false;
  for (const { model, rows } of loaded) {
    if (rows.length > perModel) saturated = true;
    for (const row of rows.slice(0, perModel)) {
      if (!visibleToPrincipal(principal, row.scopes)) continue;
      all.push(
        buildSyncAction({
          syncId: row.syncId,
          organizationId: principal.organizationId,
          scopes: row.scopes,
          action: 'update',
          model,
          modelId: row.modelId,
          data: row.data,
          actor: CATCHUP_ACTOR,
        }),
      );
    }
  }

  all.sort((left, right) => left.syncId - right.syncId);
  const actions = all.slice(0, limit);
  return {
    syncId: actions.reduce((highest, action) => Math.max(highest, action.syncId), since),
    actions,
    truncated: saturated || all.length > actions.length,
  };
}
