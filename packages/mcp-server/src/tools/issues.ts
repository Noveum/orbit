import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createIssue,
  getIssue,
  listIssueLabels,
  listIssues,
  listLabels,
  listRelations,
  moveIssue,
  setRelation,
  updateIssue,
} from '@orbit/core';
import { db, eq, inArray, schema } from '@orbit/db';
import { ISSUE_RELATION_TYPES, STATE_CATEGORIES } from '@orbit/shared/constants';
import { notFound, validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { branchName } from '@orbit/shared/utils';
import { z } from 'zod';
import { createComment } from '../comments.ts';
import {
  resolveCycle,
  resolveLabelIds,
  resolveProject,
  resolveStateId,
  resolveTeam,
  resolveUserId,
} from '../resolve.ts';
import { deltaViews, describeIssue, describeIssues } from '../views.ts';
import { defineTool, publish } from './support.ts';

const PRIORITY_VALUES = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 } as const;

const issueRef = z.string().min(1).describe('An issue identifier like "ENG-42", or an issue id.');

const priorityRef = z
  .enum(['none', 'urgent', 'high', 'medium', 'low'])
  .describe('Issue priority, from "urgent" down to "low".');

const dueDateRef = z.iso.date().describe('Due date as YYYY-MM-DD.');

const labelsRef = z
  .array(z.string().min(1))
  .max(50)
  .describe('Label names or ids. Replaces the labels already on the issue.');

async function issueLabelNames(principal: Principal, issueId: string): Promise<string[]> {
  const [assigned, labels] = await Promise.all([
    listIssueLabels(principal, issueId),
    listLabels(principal, {}),
  ]);
  const names = new Map(labels.map((label) => [label.id, label.name]));
  return assigned.map((row) => names.get(row.labelId) ?? row.labelId);
}

async function issueRelationViews(
  principal: Principal,
  issueId: string,
): Promise<{ type: string; identifier: string }[]> {
  const relations = await listRelations(principal, issueId);
  if (relations.length === 0) return [];
  const rows = await db
    .select({ id: schema.issue.id, identifier: schema.issue.identifier })
    .from(schema.issue)
    .where(
      inArray(
        schema.issue.id,
        relations.map((relation) => relation.relatedIssueId),
      ),
    );
  const identifiers = new Map(rows.map((row) => [row.id, row.identifier]));
  return relations.map((relation) => ({
    type: relation.type,
    identifier: identifiers.get(relation.relatedIssueId) ?? relation.relatedIssueId,
  }));
}

function registerCreateIssue(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_issue',
      title: 'Create an issue',
      description:
        'Create an issue on a team. The workflow state defaults to the team first unstarted state. Returns the new issue with its identifier such as "ENG-42".',
      readOnly: false,
      inputSchema: {
        team: z.string().min(1).describe('Team key like "ENG", team name, or team id.'),
        title: z.string().min(1).max(255).describe('One line summary of the work.'),
        description: z.string().max(100_000).optional().describe('Markdown body of the issue.'),
        state: z.string().min(1).optional().describe('Workflow state name or id on that team.'),
        priority: priorityRef.optional(),
        assignee: z
          .string()
          .min(1)
          .optional()
          .describe('Assignee name, handle, email, id, or "me".'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        cycle: z
          .string()
          .min(1)
          .optional()
          .describe('Cycle name, number, id, or "active" for the running cycle.'),
        parent: issueRef.optional().describe('Parent issue, making this a sub issue.'),
        labels: labelsRef.optional(),
        estimate: z.number().int().min(0).max(100).optional().describe('Estimate points.'),
        dueDate: dueDateRef.optional(),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const patch = await buildIssuePatch(principal, team.id, args);
      const created = await createIssue(principal, {
        ...patch,
        teamId: team.id,
        title: args.title,
        ...(args.parent === undefined
          ? {}
          : { parentId: (await getIssue(principal, args.parent)).id }),
      });
      await publish(created.actions);
      return {
        issue: await describeIssue(principal, created.issue),
        deltas: deltaViews(created.actions),
      };
    },
  );
}

function registerUpdateIssue(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'update_issue',
      title: 'Update an issue',
      description:
        'Change fields on an existing issue. Only the fields you pass are touched. Pass null to assignee, project or cycle to clear it.',
      readOnly: false,
      inputSchema: {
        issue: issueRef,
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(100_000).optional().describe('Replaces the markdown body.'),
        state: z
          .string()
          .min(1)
          .optional()
          .describe('Workflow state name or id on the issue team.'),
        priority: priorityRef.optional(),
        assignee: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .describe('Assignee name, handle, email, id, "me", or null to unassign.'),
        project: z
          .string()
          .min(1)
          .nullable()
          .optional()
          .describe('Project name, slug, id or null.'),
        cycle: z.string().min(1).nullable().optional().describe('Cycle name, number, id or null.'),
        labels: labelsRef.optional(),
        estimate: z.number().int().min(0).max(100).nullable().optional(),
        dueDate: dueDateRef.nullable().optional(),
      },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const patch = await buildIssuePatch(principal, issue.teamId, args);
      const updated = await updateIssue(principal, issue.id, patch);
      await publish(updated.actions);
      return {
        issue: await describeIssue(principal, updated.issue),
        changed: updated.changes.map((change) => change.field),
        deltas: deltaViews(updated.actions),
      };
    },
  );
}

interface IssuePatchArgs {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly state?: string | undefined;
  readonly priority?: keyof typeof PRIORITY_VALUES | undefined;
  readonly assignee?: string | null | undefined;
  readonly project?: string | null | undefined;
  readonly cycle?: string | null | undefined;
  readonly labels?: string[] | undefined;
  readonly estimate?: number | null | undefined;
  readonly dueDate?: string | null | undefined;
}

async function buildIssuePatch(
  principal: Principal,
  teamId: string,
  args: IssuePatchArgs,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) patch['title'] = args.title;
  if (args.description !== undefined) patch['description'] = args.description;
  if (args.estimate !== undefined) patch['estimate'] = args.estimate;
  if (args.dueDate !== undefined) patch['dueDate'] = args.dueDate;
  if (args.priority !== undefined) patch['priority'] = PRIORITY_VALUES[args.priority];
  if (args.state !== undefined)
    patch['stateId'] = await resolveStateId(principal, teamId, args.state);
  if (args.labels !== undefined)
    patch['labelIds'] = await resolveLabelIds(principal, args.labels, teamId);
  if (args.assignee !== undefined) {
    patch['assigneeId'] =
      args.assignee === null ? null : await resolveUserId(principal, args.assignee);
  }
  if (args.project !== undefined) {
    patch['projectId'] =
      args.project === null ? null : (await resolveProject(principal, args.project)).id;
  }
  if (args.cycle !== undefined) {
    patch['cycleId'] =
      args.cycle === null ? null : (await resolveCycle(principal, teamId, args.cycle)).id;
  }
  return patch;
}

function registerGetIssue(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'get_issue',
      title: 'Get an issue',
      description:
        'Fetch one issue by identifier such as "ENG-42" or by id, including its description, labels and relations.',
      readOnly: true,
      inputSchema: { issue: issueRef },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      return {
        issue: {
          ...(await describeIssue(principal, issue)),
          description: issue.description,
          labels: await issueLabelNames(principal, issue.id),
          relations: await issueRelationViews(principal, issue.id),
        },
      };
    },
  );
}

function registerSearchIssues(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'search_issues',
      title: 'Search issues',
      description:
        'Search issues by free text and by team, project, cycle, assignee, state, state category, label or parent. Returns a page of issues plus a cursor for the next page.',
      readOnly: true,
      inputSchema: {
        query: z
          .string()
          .max(200)
          .optional()
          .describe('Text matched against title, description and identifier.'),
        team: z.string().min(1).optional().describe('Team key, name or id.'),
        project: z.string().min(1).optional().describe('Project name, slug or id.'),
        cycle: z
          .string()
          .min(1)
          .optional()
          .describe('Cycle name, number, id or "active". Needs team.'),
        assignee: z
          .string()
          .min(1)
          .optional()
          .describe('Assignee name, handle, email, id, or "me".'),
        state: z.string().min(1).optional().describe('Workflow state name or id. Needs team.'),
        stateCategory: z.enum(STATE_CATEGORIES).optional().describe('Broad status bucket.'),
        label: z.string().min(1).optional().describe('Label name or id.'),
        parent: z.string().min(1).optional().describe('Parent issue identifier or id.'),
        includeArchived: z.boolean().default(false),
        includeSubIssues: z.boolean().default(true),
        orderBy: z.enum(['manual', 'priority', 'created', 'updated', 'due']).default('updated'),
        limit: z.number().int().min(1).max(200).default(25),
        cursor: z.string().max(256).optional().describe('Cursor returned by a previous call.'),
      },
    },
    async (args) => {
      const teamId =
        args.team === undefined ? undefined : (await resolveTeam(principal, args.team)).id;
      const filter = await buildIssueFilter(principal, teamId, args);
      const page = await listIssues(principal, filter);
      return {
        issues: await describeIssues(principal, page.issues),
        nextCursor: page.nextCursor,
      };
    },
  );
}

interface IssueFilterArgs {
  readonly query?: string | undefined;
  readonly project?: string | undefined;
  readonly cycle?: string | undefined;
  readonly assignee?: string | undefined;
  readonly state?: string | undefined;
  readonly stateCategory?: (typeof STATE_CATEGORIES)[number] | undefined;
  readonly label?: string | undefined;
  readonly parent?: string | undefined;
  readonly includeArchived: boolean;
  readonly includeSubIssues: boolean;
  readonly orderBy: 'manual' | 'priority' | 'created' | 'updated' | 'due';
  readonly limit: number;
  readonly cursor?: string | undefined;
}

async function buildIssueFilter(
  principal: Principal,
  teamId: string | undefined,
  args: IssueFilterArgs,
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {
    includeArchived: args.includeArchived,
    includeSubIssues: args.includeSubIssues,
    orderBy: args.orderBy,
    limit: args.limit,
  };
  if (teamId !== undefined) filter['teamId'] = teamId;
  if (args.query !== undefined) filter['query'] = args.query;
  if (args.cursor !== undefined) filter['cursor'] = args.cursor;
  if (args.stateCategory !== undefined) filter['stateCategory'] = args.stateCategory;
  if (args.project !== undefined)
    filter['projectId'] = (await resolveProject(principal, args.project)).id;
  if (args.assignee !== undefined)
    filter['assigneeId'] = await resolveUserId(principal, args.assignee);
  if (args.parent !== undefined) filter['parentId'] = (await getIssue(principal, args.parent)).id;
  if (args.label !== undefined) {
    const [labelId] = await resolveLabelIds(principal, [args.label], teamId);
    if (labelId !== undefined) filter['labelId'] = labelId;
  }
  if (args.state !== undefined) {
    if (teamId === undefined) throw validationFailed('Pass a team when filtering by state.');
    filter['stateId'] = await resolveStateId(principal, teamId, args.state);
  }
  if (args.cycle !== undefined) {
    if (teamId === undefined) throw validationFailed('Pass a team when filtering by cycle.');
    filter['cycleId'] = (await resolveCycle(principal, teamId, args.cycle)).id;
  }
  return filter;
}

function registerListMyIssues(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_my_issues',
      title: 'List my issues',
      description:
        'List the issues assigned to the caller, most recently updated first. Narrow with a state category such as "started" to see only work in flight.',
      readOnly: true,
      inputSchema: {
        stateCategory: z
          .enum(STATE_CATEGORIES)
          .optional()
          .describe('Narrow to one status bucket, for example "started".'),
        limit: z.number().int().min(1).max(200).default(25),
      },
    },
    async (args) => {
      const page = await listIssues(principal, {
        assigneeId: principal.userId,
        orderBy: 'updated',
        limit: args.limit,
        ...(args.stateCategory === undefined ? {} : { stateCategory: args.stateCategory }),
      });
      return {
        issues: await describeIssues(principal, page.issues),
        nextCursor: page.nextCursor,
      };
    },
  );
}

function registerMoveIssue(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'move_issue',
      title: 'Move an issue',
      description:
        'Move an issue to another workflow state or team, and optionally place it between two issues in the column. This is the tool to use to change status.',
      readOnly: false,
      inputSchema: {
        issue: issueRef,
        state: z.string().min(1).optional().describe('Target workflow state name or id.'),
        team: z.string().min(1).optional().describe('Target team key, name or id.'),
        beforeIssue: issueRef.optional().describe('Place after this issue in the column.'),
        afterIssue: issueRef.optional().describe('Place before this issue in the column.'),
      },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const teamId =
        args.team === undefined ? issue.teamId : (await resolveTeam(principal, args.team)).id;
      const moved = await moveIssue(principal, issue.id, {
        ...(args.team === undefined ? {} : { teamId }),
        ...(args.state === undefined
          ? {}
          : { stateId: await resolveStateId(principal, teamId, args.state) }),
        ...(args.beforeIssue === undefined
          ? {}
          : { beforeId: (await getIssue(principal, args.beforeIssue)).id }),
        ...(args.afterIssue === undefined
          ? {}
          : { afterId: (await getIssue(principal, args.afterIssue)).id }),
      });
      await publish(moved.actions);
      return {
        issue: await describeIssue(principal, moved.issue),
        rebalanced: moved.rebalanced.length,
        deltas: deltaViews(moved.actions),
      };
    },
  );
}

function registerAddComment(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'add_comment',
      title: 'Comment on an issue',
      description: 'Post a markdown comment on an issue, optionally as a reply to another comment.',
      readOnly: false,
      inputSchema: {
        issue: issueRef,
        body: z.string().min(1).max(100_000).describe('Markdown body of the comment.'),
        replyTo: z.string().min(1).optional().describe('Id of the comment being replied to.'),
      },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const created = await createComment(principal, issue, {
        body: args.body,
        parentId: args.replyTo ?? null,
      });
      await publish(created.actions);
      return {
        comment: {
          id: created.comment.id,
          issue: issue.identifier,
          body: created.comment.body,
          createdAt: created.comment.createdAt.toISOString(),
        },
        deltas: deltaViews(created.actions),
      };
    },
  );
}

function registerSetRelation(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'set_relation',
      title: 'Relate two issues',
      description:
        'Link two issues. The inverse link is written on the other issue automatically, so "blocks" also records "blocked by".',
      readOnly: false,
      inputSchema: {
        issue: issueRef,
        relatedIssue: issueRef.describe('The issue on the other end of the link.'),
        type: z.enum(ISSUE_RELATION_TYPES).describe('How the first issue relates to the second.'),
      },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const related = await getIssue(principal, args.relatedIssue);
      const result = await setRelation(principal, issue.id, {
        relatedIssueId: related.id,
        type: args.type,
      });
      await publish(result.actions);
      return {
        issue: issue.identifier,
        relatedIssue: related.identifier,
        type: args.type,
        deltas: deltaViews(result.actions),
      };
    },
  );
}

function registerCopyBranchName(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'copy_branch_name',
      title: 'Get the git branch name for an issue',
      description:
        'Return the git branch name Orbit uses for an issue, in the form handle/eng-42-short-title.',
      readOnly: true,
      inputSchema: { issue: issueRef },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const [user] = await db
        .select({ handle: schema.user.handle })
        .from(schema.user)
        .where(eq(schema.user.id, principal.userId))
        .limit(1);
      if (user === undefined) throw notFound('That user no longer exists.');
      return {
        issue: issue.identifier,
        branch: branchName({
          username: user.handle,
          identifier: issue.identifier,
          title: issue.title,
        }),
      };
    },
  );
}

export function registerIssueTools(server: McpServer, principal: Principal): void {
  registerCreateIssue(server, principal);
  registerUpdateIssue(server, principal);
  registerGetIssue(server, principal);
  registerSearchIssues(server, principal);
  registerListMyIssues(server, principal);
  registerMoveIssue(server, principal);
  registerAddComment(server, principal);
  registerSetRelation(server, principal);
  registerCopyBranchName(server, principal);
}
