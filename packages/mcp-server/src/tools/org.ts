import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addTeamMember,
  createTeam,
  createView,
  deleteView,
  listMembers,
  listViews,
  removeMember,
  removeTeamMember,
  updateTeam,
  updateView,
} from '@orbit/core';
import { conflict, notFound } from '@orbit/shared/errors';
import { countConditions, GROUP_BY_FIELDS, VIEW_LAYOUTS } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveTeam, resolveUserId } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const teamRef = z.string().min(1).describe('Team key like "ENG", team name, or team id.');
const personRef = z.string().min(1).describe('Person name, handle, email, id, or "me".');

const VIEW_FILTER_HINT =
  'The saved view state. Conditions live under filter.filter.children, each one {"kind":"condition","property":"priority","operator":"in","values":["1"]}. Other keys are teamId, projectId, groupBy, subGroupBy, orderBy, layout, display, visibility, locked and position. A key this list does not name is rejected rather than dropped.';

const VIEW_FILTER_GUIDE = `Save a filtered issue view. Call list_views first and copy the filter of a view that already works. ${VIEW_FILTER_HINT} The reply says how many conditions were stored, so check it matches what you sent.`;

async function resolveView(principal: Principal, ref: string): Promise<string> {
  const needle = ref.trim();
  const saved = (await listViews(principal)).filter((view) => !view.virtual);
  const byId = saved.find((view) => view.id === needle);
  if (byId !== undefined) return byId.id;

  const lowered = needle.toLowerCase();
  const matches = saved.filter((view) => view.name.trim().toLowerCase() === lowered);
  const first = matches[0];
  if (first === undefined) throw notFound(`No saved view matches "${ref}".`);
  if (matches.length > 1) {
    throw conflict(`More than one saved view is called "${ref}". Pass the view id instead.`);
  }
  return first.id;
}

export function registerOrgTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_team',
      title: 'Create a team',
      description:
        'Create a team with its own issue prefix, default workflow states and first sprint.',
      readOnly: false,
      inputSchema: {
        name: z.string().trim().min(2).max(64).describe('Team name.'),
        key: z
          .string()
          .trim()
          .min(2)
          .max(6)
          .describe('Issue prefix such as "ENG". Uppercase letters and digits.'),
        description: z.string().max(1000).optional(),
      },
    },
    async (args) => {
      const created = await createTeam(principal, {
        name: args.name,
        key: args.key,
        ...(args.description === undefined ? {} : { description: args.description }),
      });
      await publish(created.actions);
      return { team: { id: created.team.id, key: created.team.key, name: created.team.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'update_team',
      title: 'Update a team',
      description: 'Rename a team or change its description. The issue prefix cannot change.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        name: z.string().trim().min(2).max(64).optional(),
        description: z.string().max(1000).optional(),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const saved = await updateTeam(principal, team.id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
      });
      await publish(saved.actions);
      return { team: { id: saved.team.id, key: saved.team.key, name: saved.team.name } };
    },
  );

  defineTool(
    server,
    {
      name: 'add_team_member',
      title: 'Add somebody to a team',
      description: 'Put a workspace member on a team so they see its issues and sprints.',
      readOnly: false,
      inputSchema: { team: teamRef, person: personRef },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const userId = await resolveUserId(principal, args.person);
      const saved = await addTeamMember(principal, team.id, { userId });
      await publish(saved.actions);
      return { added: { teamId: team.id, userId } };
    },
  );

  defineTool(
    server,
    {
      name: 'remove_team_member',
      title: 'Remove somebody from a team',
      description: 'Take a person off a team. They stay in the workspace.',
      readOnly: false,
      inputSchema: { team: teamRef, person: personRef },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const userId = await resolveUserId(principal, args.person);
      await publish(await removeTeamMember(principal, team.id, userId));
      return { removed: { teamId: team.id, userId } };
    },
  );

  defineTool(
    server,
    {
      name: 'remove_member',
      title: 'Remove somebody from the workspace',
      description:
        'Remove a member from the workspace entirely. Their issues can be reassigned to somebody else in the same call.',
      readOnly: false,
      inputSchema: {
        person: personRef,
        reassignTo: personRef.optional().describe('Who inherits their open issues.'),
      },
    },
    async (args) => {
      const userId = await resolveUserId(principal, args.person);
      const members = await listMembers(principal);
      const member = members.find((entry) => entry.user.id === userId);
      if (member === undefined) throw notFound(`No member matches "${args.person}".`);
      const reassignTo =
        args.reassignTo === undefined ? undefined : await resolveUserId(principal, args.reassignTo);
      const result = await removeMember(principal, member.member.id, {
        ...(reassignTo === undefined ? {} : { reassignToUserId: reassignTo }),
      });
      await publish(result.actions);
      return { removed: userId, reassignedIssues: result.reassignedIssueIds.length };
    },
  );

  defineTool(
    server,
    {
      name: 'list_views',
      title: 'List saved views',
      description:
        'Return the saved issue views this user can open, each with the filter state it stores. Copy that shape when creating or updating a view.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const views = await listViews(principal);
      return {
        views: views.map((view) => ({
          id: view.id,
          name: view.name,
          layout: view.layout,
          groupBy: view.groupBy,
          shared: view.shared,
          readable: view.readable,
          filter: view.state,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'create_view',
      title: 'Create a saved view',
      description: VIEW_FILTER_GUIDE,
      readOnly: false,
      inputSchema: {
        name: z.string().trim().min(1).max(120).describe('View name.'),
        filter: z.record(z.string(), z.unknown()).describe(VIEW_FILTER_HINT),
        layout: z.enum(VIEW_LAYOUTS).optional(),
        groupBy: z.enum(GROUP_BY_FIELDS).optional(),
        shared: z.boolean().optional().describe('Share the view with the whole workspace.'),
      },
    },
    async (args) => {
      const saved = await createView(principal, {
        name: args.name,
        filter: args.filter,
        ...(args.layout === undefined ? {} : { layout: args.layout }),
        ...(args.groupBy === undefined ? {} : { groupBy: args.groupBy }),
        ...(args.shared === undefined ? {} : { shared: args.shared }),
      });
      await publish(saved.actions);
      return {
        view: {
          id: saved.view.id,
          name: saved.view.name,
          conditions: countConditions(saved.view.state.filter),
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'update_view',
      title: 'Update a saved view',
      description:
        'Rename a saved view, change its layout or grouping, share it, or replace the filter it stores. Read the view first with list_views and send the whole filter state back, because a filter replaces the stored one rather than merging into it.',
      readOnly: false,
      inputSchema: {
        view: z.string().min(1).describe('View name or id.'),
        name: z.string().trim().min(1).max(120).optional(),
        filter: z.record(z.string(), z.unknown()).optional().describe(VIEW_FILTER_HINT),
        layout: z.enum(VIEW_LAYOUTS).optional(),
        groupBy: z.enum(GROUP_BY_FIELDS).optional(),
        shared: z.boolean().optional(),
      },
    },
    async (args) => {
      const id = await resolveView(principal, args.view);
      const saved = await updateView(principal, id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.filter === undefined ? {} : { filter: args.filter }),
        ...(args.layout === undefined ? {} : { layout: args.layout }),
        ...(args.groupBy === undefined ? {} : { groupBy: args.groupBy }),
        ...(args.shared === undefined ? {} : { shared: args.shared }),
      });
      await publish(saved.actions);
      return {
        view: {
          id: saved.view.id,
          name: saved.view.name,
          conditions: countConditions(saved.view.state.filter),
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_view',
      title: 'Delete a saved view',
      description: 'Remove a saved view.',
      readOnly: false,
      inputSchema: { view: z.string().min(1).describe('View name or id.') },
    },
    async (args) => {
      const id = await resolveView(principal, args.view);
      await publish(await deleteView(principal, id));
      return { deleted: args.view };
    },
  );
}
