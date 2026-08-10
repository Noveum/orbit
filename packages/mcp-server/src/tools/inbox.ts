import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, db, eq, inArray, schema } from '@orbit/db';
import { listInbox, markRead } from '@orbit/services/notifications';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { defineTool } from './support.ts';

interface IssueSummary {
  readonly identifier: string;
  readonly title: string;
  readonly teamKey: string;
}

interface DocSummary {
  readonly id: string;
  readonly title: string;
}

async function docIdsForComments(commentIds: readonly string[]): Promise<Map<string, string>> {
  if (commentIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.docComment.id, docId: schema.docComment.docId })
    .from(schema.docComment)
    .where(inArray(schema.docComment.id, [...commentIds]));
  return new Map(rows.map((row) => [row.id, row.docId]));
}

async function docSummaries(
  organizationId: string,
  docIds: readonly string[],
): Promise<Map<string, DocSummary>> {
  if (docIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.doc.id, title: schema.doc.title })
    .from(schema.doc)
    .where(and(eq(schema.doc.organizationId, organizationId), inArray(schema.doc.id, [...docIds])));
  return new Map(rows.map((row) => [row.id, { id: row.id, title: row.title }]));
}

async function issueIdsForComments(
  organizationId: string,
  commentIds: readonly string[],
): Promise<Map<string, string>> {
  if (commentIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.comment.id, issueId: schema.comment.issueId })
    .from(schema.comment)
    .where(
      and(
        eq(schema.comment.organizationId, organizationId),
        inArray(schema.comment.id, [...commentIds]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.issueId]));
}

async function issueSummaries(
  organizationId: string,
  issueIds: readonly string[],
): Promise<Map<string, IssueSummary>> {
  if (issueIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.issue.id,
      identifier: schema.issue.identifier,
      title: schema.issue.title,
      teamKey: schema.team.key,
    })
    .from(schema.issue)
    .innerJoin(schema.team, eq(schema.team.id, schema.issue.teamId))
    .where(
      and(eq(schema.issue.organizationId, organizationId), inArray(schema.issue.id, [...issueIds])),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      { identifier: row.identifier, title: row.title, teamKey: row.teamKey },
    ]),
  );
}

export function registerInboxTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_notifications',
      title: 'List your notifications',
      description:
        'Your inbox: mentions, assignments, replies and state changes addressed to you. This is how you find work someone has handed you by name. Orbit never notifies you about your own actions, so nothing here was written by you.',
      readOnly: true,
      inputSchema: {
        unreadOnly: z
          .boolean()
          .optional()
          .describe('Only unread notifications. Defaults to false.'),
        type: z.enum(NOTIFICATION_TYPES).optional().describe('Only this notification type.'),
        limit: z.number().int().min(1).max(100).optional().describe('Notifications per page.'),
        cursor: z.string().min(1).optional().describe('Cursor returned by a previous call.'),
      },
    },
    async (args) => {
      const page = await listInbox(db, {
        userId: principal.userId,
        organizationId: principal.organizationId,
        ...(args.unreadOnly === undefined ? {} : { unreadOnly: args.unreadOnly }),
        ...(args.type === undefined ? {} : { type: args.type }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      });

      const commentIds = page.items
        .filter((item) => item.entityType === 'comment')
        .map((item) => item.entityId);
      const byComment = await issueIdsForComments(principal.organizationId, commentIds);

      const docCommentIds = page.items
        .filter((item) => item.entityType === 'doc_comment')
        .map((item) => item.entityId);
      const byDocComment = await docIdsForComments(docCommentIds);

      const docIds = page.items.flatMap((item) => {
        if (item.entityType === 'doc') return [item.entityId];
        const resolved = byDocComment.get(item.entityId);
        return resolved === undefined ? [] : [resolved];
      });
      const byDoc = await docSummaries(principal.organizationId, docIds);

      const issueIds = page.items.flatMap((item) => {
        if (item.entityType === 'issue') return [item.entityId];
        const resolved = byComment.get(item.entityId);
        return resolved === undefined ? [] : [resolved];
      });
      const byIssue = await issueSummaries(principal.organizationId, issueIds);

      return {
        notifications: page.items.map((item) => {
          const issueId =
            item.entityType === 'issue' ? item.entityId : byComment.get(item.entityId);
          const docId = item.entityType === 'doc' ? item.entityId : byDocComment.get(item.entityId);
          return {
            id: item.id,
            type: item.type,
            reason: item.reason,
            actorName: item.actorName,
            title: item.title,
            body: item.body,
            url: item.url,
            createdAt: item.createdAt.toISOString(),
            read: item.readAt !== null,
            issue: issueId === undefined ? null : (byIssue.get(issueId) ?? null),
            doc: docId === undefined ? null : (byDoc.get(docId) ?? null),
          };
        }),
        nextCursor: page.nextCursor,
        unreadCount: page.unreadCount,
      };
    },
  );

  defineTool(
    server,
    {
      name: 'mark_notification_read',
      title: 'Mark notifications read',
      description:
        'Mark your own notifications read once you have acted on them, so they leave your unread queue. Mark a notification read only after the work it describes is done or handed on, never on first sight.',
      readOnly: false,
      inputSchema: {
        ids: z
          .array(z.string().min(1))
          .min(1)
          .max(100)
          .describe('Notification ids from list_notifications.'),
      },
    },
    async (args) => {
      const updated = await markRead(db, {
        userId: principal.userId,
        organizationId: principal.organizationId,
        notificationIds: args.ids,
        read: true,
      });
      return { markedIds: updated.map((row) => row.id) };
    },
  );
}
