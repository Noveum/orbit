import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  archiveIssue,
  archiveProject,
  createLabel,
  deleteComment,
  deleteCycle,
  deleteIssue,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  getIssue,
  listLabels,
  listMilestones,
  unarchiveIssue,
  updateComment,
  updateLabel,
  updateMilestone,
  updateProject,
} from '@orbit/core';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveCycle, resolveProject, resolveTeam } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const issueRef = z.string().min(1).describe('An issue identifier like "ENG-42", or an issue id.');
const projectRef = z.string().min(1).describe('Project name, slug or id.');

const DEFAULT_LABEL_COLOR = '#5a63c8';

async function resolveLabel(principal: Principal, ref: string): Promise<string> {
  const needle = ref.trim();
  const labels = await listLabels(principal, {});
  const lowered = needle.toLowerCase();
  const found = labels.find(
    (label) => label.id === needle || label.name.trim().toLowerCase() === lowered,
  );
  if (found === undefined) throw notFound(`No label matches "${ref}".`);
  return found.id;
}

export function registerWorkspaceTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'archive_issue',
      title: 'Archive an issue',
      description:
        'Archive an issue so it leaves the board and the default lists. Use delete_issue to remove it for good.',
      readOnly: false,
      inputSchema: { issue: issueRef },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const saved = await archiveIssue(principal, issue.id);
      await publish(saved.actions);
      return { archived: { id: saved.issue.id, identifier: saved.issue.identifier } };
    },
  );

  defineTool(
    server,
    {
      name: 'unarchive_issue',
      title: 'Restore an archived issue',
      description: 'Bring an archived issue back onto the board.',
      readOnly: false,
      inputSchema: { issue: issueRef },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const saved = await unarchiveIssue(principal, issue.id);
      await publish(saved.actions);
      return { restored: { id: saved.issue.id, identifier: saved.issue.identifier } };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_issue',
      title: 'Delete an issue',
      description:
        'Permanently delete an issue and everything attached to it. This cannot be undone; prefer archive_issue.',
      readOnly: false,
      inputSchema: { issue: issueRef },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const actions = await deleteIssue(principal, issue.id);
      await publish(actions);
      return { deleted: issue.identifier };
    },
  );

  defineTool(
    server,
    {
      name: 'edit_comment',
      title: 'Edit a comment',
      description: 'Rewrite the body of a comment this user wrote on an issue.',
      readOnly: false,
      inputSchema: {
        commentId: z.string().min(1).describe('The comment id.'),
        body: z.string().min(1).max(50_000).describe('Replacement Markdown body.'),
      },
    },
    async (args) => {
      const saved = await updateComment(principal, args.commentId, { body: args.body });
      await publish(saved.actions);
      return { comment: args.commentId };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_comment',
      title: 'Delete a comment',
      description: 'Remove a comment from an issue.',
      readOnly: false,
      inputSchema: { commentId: z.string().min(1).describe('The comment id.') },
    },
    async (args) => {
      const actions = await deleteComment(principal, args.commentId);
      await publish(actions);
      return { deleted: args.commentId };
    },
  );

  defineTool(
    server,
    {
      name: 'create_label',
      title: 'Create a label',
      description: 'Create a workspace label that can be applied to issues.',
      readOnly: false,
      inputSchema: {
        name: z.string().trim().min(1).max(60).describe('Label name.'),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .describe('Hex colour such as "#7c3aed". Defaults to the Orbit accent.'),
      },
    },
    async (args) => {
      const saved = await createLabel(principal, {
        name: args.name,
        color: args.color ?? DEFAULT_LABEL_COLOR,
      });
      await publish(saved.actions);
      return { label: { id: saved.label.id, name: saved.label.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'update_label',
      title: 'Update a label',
      description: 'Rename a label or change its colour.',
      readOnly: false,
      inputSchema: {
        label: z.string().min(1).describe('Label name or id.'),
        name: z.string().trim().min(1).max(60).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      },
    },
    async (args) => {
      const id = await resolveLabel(principal, args.label);
      const saved = await updateLabel(principal, id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.color === undefined ? {} : { color: args.color }),
      });
      await publish(saved.actions);
      return { label: { id: saved.label.id, name: saved.label.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_label',
      title: 'Delete a label',
      description: 'Remove a label from the workspace and from every issue carrying it.',
      readOnly: false,
      inputSchema: { label: z.string().min(1).describe('Label name or id.') },
    },
    async (args) => {
      const id = await resolveLabel(principal, args.label);
      const actions = await deleteLabel(principal, id);
      await publish(actions);
      return { deleted: args.label };
    },
  );

  defineTool(
    server,
    {
      name: 'update_project',
      title: 'Update a project',
      description:
        'Change a project name, summary, status, health, lead or target dates. Only the fields you pass are touched.',
      readOnly: false,
      inputSchema: {
        project: projectRef,
        name: z.string().trim().min(1).max(120).optional(),
        summary: z.string().max(500).optional(),
        description: z.string().max(100_000).optional(),
        status: z.string().min(1).optional().describe('Project status such as "in_progress".'),
        health: z.string().min(1).optional().describe('Project health such as "on_track".'),
        startDate: z.iso.date().nullable().optional().describe('Start date as YYYY-MM-DD.'),
        targetDate: z.iso.date().nullable().optional().describe('Target date as YYYY-MM-DD.'),
      },
    },
    async (args) => {
      const project = await resolveProject(principal, args.project);
      const saved = await updateProject(principal, project.id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.health === undefined ? {} : { health: args.health }),
        ...(args.startDate === undefined ? {} : { startDate: args.startDate }),
        ...(args.targetDate === undefined ? {} : { targetDate: args.targetDate }),
      });
      await publish(saved.actions);
      return { project: { id: saved.project.id, name: saved.project.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'archive_project',
      title: 'Archive a project',
      description: 'Archive a project so it leaves the active lists. Its issues are kept.',
      readOnly: false,
      inputSchema: { project: projectRef },
    },
    async (args) => {
      const project = await resolveProject(principal, args.project);
      const saved = await archiveProject(principal, project.id);
      await publish(saved.actions);
      return { archived: { id: saved.project.id, name: saved.project.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_project',
      title: 'Delete a project',
      description:
        'Permanently delete a project. Its issues survive but lose their project link. Prefer archive_project.',
      readOnly: false,
      inputSchema: { project: projectRef },
    },
    async (args) => {
      const project = await resolveProject(principal, args.project);
      const actions = await deleteProject(principal, project.id);
      await publish(actions);
      return { deleted: project.name };
    },
  );

  defineTool(
    server,
    {
      name: 'update_milestone',
      title: 'Update a milestone',
      description: 'Rename a milestone or move its target date.',
      readOnly: false,
      inputSchema: {
        milestoneId: z.string().min(1).describe('The milestone id.'),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(2000).optional(),
        targetDate: z.iso.date().nullable().optional().describe('Target date as YYYY-MM-DD.'),
      },
    },
    async (args) => {
      const saved = await updateMilestone(principal, args.milestoneId, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.targetDate === undefined ? {} : { targetDate: args.targetDate }),
      });
      await publish(saved.actions);
      return { milestone: { id: saved.milestone.id, name: saved.milestone.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_milestone',
      title: 'Delete a milestone',
      description: 'Remove a milestone. Its issues survive but lose the milestone link.',
      readOnly: false,
      inputSchema: { milestoneId: z.string().min(1).describe('The milestone id.') },
    },
    async (args) => {
      const actions = await deleteMilestone(principal, args.milestoneId);
      await publish(actions);
      return { deleted: args.milestoneId };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_sprint',
      title: 'Delete a sprint',
      description:
        'Remove a sprint. Its issues survive and fall back to no sprint, which is what descoping a cancelled sprint needs.',
      readOnly: false,
      inputSchema: {
        team: z.string().min(1).describe('Team key like "ENG", team name, or team id.'),
        sprint: z.string().min(1).describe('Sprint name, number or id.'),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const cycle = await resolveCycle(principal, team.id, args.sprint);
      const actions = await deleteCycle(principal, cycle.id);
      await publish(actions);
      return { deleted: cycle.name };
    },
  );

  defineTool(
    server,
    {
      name: 'list_project_milestones',
      title: 'List milestones on a project',
      description: 'Return the milestones on a project with their target dates.',
      readOnly: true,
      inputSchema: { project: projectRef },
    },
    async (args) => {
      const project = await resolveProject(principal, args.project);
      const rows = await listMilestones(principal, project.id);
      return {
        milestones: rows.map((row) => ({
          id: row.id,
          name: row.name,
          targetDate: row.targetDate,
        })),
      };
    },
  );
}
