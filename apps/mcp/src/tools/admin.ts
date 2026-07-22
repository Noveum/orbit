import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createInvite, listMembers } from '@orbit/core';
import { ORG_ROLES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveTeam } from '../resolve.ts';
import { deltaViews } from '../views.ts';
import { defineTool, publish } from './support.ts';

export function registerAdminTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_members',
      title: 'List workspace members',
      description:
        'List workspace membership with each person role, which is what decides what they may do.',
      readOnly: true,
      inputSchema: {},
    },
    async () => {
      const members = await listMembers(principal);
      return {
        members: members.map((row) => ({
          memberId: row.member.id,
          userId: row.user.id,
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
      name: 'invite_member',
      title: 'Invite someone to the workspace',
      description:
        'Send a workspace invite to an email address. Requires a role that can invite members. Only admins can invite admins.',
      readOnly: false,
      inputSchema: {
        email: z.string().email().describe('Email address to invite.'),
        role: z.enum(ORG_ROLES).default('member').describe('Role the invitee joins with.'),
        teams: z.array(z.string().min(1)).max(50).optional().describe('Teams to add them to.'),
      },
    },
    async (args) => {
      const teamIds: string[] = [];
      for (const ref of args.teams ?? []) teamIds.push((await resolveTeam(principal, ref)).id);
      const created = await createInvite(principal, {
        email: args.email,
        role: args.role,
        teamIds,
      });
      await publish(created.actions);
      return {
        invitation: {
          id: created.invitation.id,
          email: created.invitation.email,
          role: created.invitation.role,
          expiresAt: created.invitation.expiresAt.toISOString(),
        },
        deltas: deltaViews(created.actions),
      };
    },
  );
}
