import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getOrganization,
  listLabels,
  listMembers,
  listTeams,
  listWorkflowStates,
} from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { permissionsFor } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveTeam } from '../resolve.ts';
import { defineTool } from './support.ts';

const teamRef = z.string().min(1).describe('A team key like "ENG", a team name, or a team id.');

export function registerIdentityTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'get_me',
      title: 'Get the current identity',
      description:
        'Return the Orbit user, workspace, role and teams that this API key acts as. Call this first to learn which teams you may write to.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const [user] = await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          handle: schema.user.handle,
        })
        .from(schema.user)
        .where(eq(schema.user.id, principal.userId))
        .limit(1);
      if (user === undefined) throw notFound('That user no longer exists.');
      const organization = await getOrganization(principal.organizationId);
      const teams = await listTeams(principal);
      return {
        user,
        organization: { id: organization.id, name: organization.name, slug: organization.slug },
        role: principal.role,
        permissions: permissionsFor(principal.role),
        teams: teams.map((team) => ({ id: team.id, key: team.key, name: team.name })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'list_teams',
      title: 'List teams',
      description:
        'List the teams in the workspace that the caller can see. Each team has a key such as "ENG" that prefixes its issue identifiers.',
      readOnly: true,
      inputSchema: {
        includeArchived: z
          .boolean()
          .default(false)
          .describe('Include archived teams. Defaults to false.'),
      },
    },
    async (args) => {
      const teams = await listTeams(principal, { includeArchived: args.includeArchived });
      return {
        teams: teams.map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          archived: team.archivedAt !== null,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'list_users',
      title: 'List users',
      description:
        'List the people in the workspace. Use a name, handle or email from this list wherever a tool asks for a user.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const members = await listMembers(principal);
      return {
        users: members.map((row) => ({
          id: row.user.id,
          name: row.user.name,
          handle: row.user.handle,
          email: row.user.email,
          role: row.member.role,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'list_states',
      title: 'List workflow states',
      description:
        'List the workflow states of one team, in board order. Use a state name from this list when creating or moving an issue.',
      readOnly: true,
      inputSchema: { team: teamRef },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const states = await listWorkflowStates(principal, team.id);
      return {
        teamId: team.id,
        states: states.map((state) => ({
          id: state.id,
          name: state.name,
          category: state.category,
          position: state.position,
        })),
      };
    },
  );

  defineTool(
    server,
    {
      name: 'list_labels',
      title: 'List labels',
      description:
        'List the labels available in the workspace, optionally narrowed to the ones a team can use.',
      readOnly: true,
      inputSchema: {
        team: teamRef.optional().describe('Optional team key, name or id to narrow the labels to.'),
      },
    },
    async (args) => {
      const teamId =
        args.team === undefined ? undefined : (await resolveTeam(principal, args.team)).id;
      const labels = await listLabels(principal, teamId === undefined ? {} : { teamId });
      return {
        labels: labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
          teamId: label.teamId,
        })),
      };
    },
  );
}
