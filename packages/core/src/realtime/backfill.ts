import { and, asc, db, eq, gt, or, schema } from '@orbit/db';
import type { SyncAction, SyncModel } from '@orbit/shared/events';
import { CATCHUP_LIMIT, scopes } from '@orbit/shared/events';
import { assertCan, type Principal } from '@orbit/shared/policy';
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
    (
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
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId)],
      data: row,
    })),

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

  project: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.project)
        .where(
          and(
            eq(schema.project.organizationId, principal.organizationId),
            gt(schema.project.syncId, since),
          ),
        )
        .orderBy(asc(schema.project.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.project(row.id)],
      data: row,
    })),

  milestone: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.milestone)
        .where(
          and(
            eq(schema.milestone.organizationId, principal.organizationId),
            gt(schema.milestone.syncId, since),
          ),
        )
        .orderBy(asc(schema.milestone.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.project(row.projectId)],
      data: row,
    })),

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

  issue: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.organizationId, principal.organizationId),
            gt(schema.issue.syncId, since),
          ),
        )
        .orderBy(asc(schema.issue.syncId))
        .limit(limit)
    ).map((row) => ({
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
      data: row,
    })),

  issue_relation: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.issueRelation)
        .where(
          and(
            eq(schema.issueRelation.organizationId, principal.organizationId),
            gt(schema.issueRelation.syncId, since),
          ),
        )
        .orderBy(asc(schema.issueRelation.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [
        scopes.organization(row.organizationId),
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

  reaction: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.reaction)
        .where(
          and(
            eq(schema.reaction.organizationId, principal.organizationId),
            gt(schema.reaction.syncId, since),
          ),
        )
        .orderBy(asc(schema.reaction.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes:
        row.issueId === null
          ? [scopes.organization(row.organizationId)]
          : [scopes.organization(row.organizationId), scopes.issue(row.issueId)],
      data: row,
    })),

  attachment: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.attachment)
        .where(
          and(
            eq(schema.attachment.organizationId, principal.organizationId),
            gt(schema.attachment.syncId, since),
          ),
        )
        .orderBy(asc(schema.attachment.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes:
        row.parentType === 'doc'
          ? [scopes.organization(row.organizationId), scopes.doc(row.parentId)]
          : [scopes.organization(row.organizationId), scopes.issue(row.parentId)],
      data: row,
    })),

  doc: async (principal, since, limit) =>
    (
      await db
        .select()
        .from(schema.doc)
        .where(
          and(
            eq(schema.doc.organizationId, principal.organizationId),
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
      data: { ...row, publishToken: row.publishToken === null ? null : 'redacted' },
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
            or(eq(schema.view.ownerId, principal.userId), eq(schema.view.shared, 'true')),
            gt(schema.view.syncId, since),
          ),
        )
        .orderBy(asc(schema.view.syncId))
        .limit(limit)
    ).map((row) => ({
      modelId: row.id,
      syncId: row.syncId,
      scopes: [scopes.organization(row.organizationId), scopes.user(row.ownerId)],
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
};

export const SYNC_CATCHUP_MODELS = Object.keys(LOADERS) as SyncModel[];

export async function catchUp(
  principal: Principal,
  since: number,
  limit = CATCHUP_LIMIT,
): Promise<SyncCatchupResult> {
  assertCan(principal, 'issue:read');
  const perModel = Math.max(1, limit);
  const loaded = await Promise.all(
    SYNC_CATCHUP_MODELS.map(async (model) => ({
      model,
      rows: await LOADERS[model](principal, since, perModel + 1),
    })),
  );

  const all: SyncAction[] = [];
  let saturated = false;
  for (const { model, rows } of loaded) {
    if (rows.length > perModel) saturated = true;
    for (const row of rows.slice(0, perModel)) {
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
