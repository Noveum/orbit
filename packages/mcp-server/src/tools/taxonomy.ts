import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createLabel,
  createWorkflowState,
  deleteLabel,
  deleteWorkflowState,
  listWorkflowStates,
  reorderWorkflowStates,
  updateLabel,
  updateWorkflowState,
} from '@orbit/core';
import {
  DEFAULT_LABEL_COLOR,
  DEFAULT_STATE_COLOR,
  STATE_CATEGORIES,
} from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveLabelId, resolveStateId, resolveTeam } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const teamRef = z.string().min(1).describe('A team key like "ENG", a team name, or a team id.');
const stateRef = z.string().min(1).describe('A workflow state name or id on that team.');
const labelRef = z.string().min(1).describe('Label name or id.');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const labelTeam = z
  .string()
  .min(1)
  .nullable()
  .optional()
  .describe(
    'Team key, name or id to restrict the label to. Null or omitted keeps it workspace wide.',
  );

async function labelTeamId(
  principal: Principal,
  ref: string | null | undefined,
): Promise<string | null> {
  if (ref === null || ref === undefined) return null;
  return (await resolveTeam(principal, ref)).id;
}

function registerLabelTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_label',
      title: 'Create a label',
      description:
        'Create a label that can be applied to issues. Pass a team to keep the label on that team only, otherwise it is available across the workspace.',
      readOnly: false,
      inputSchema: {
        name: z.string().trim().min(1).max(48).describe('Label name.'),
        color: hexColor.optional().describe('Hex colour such as "#7c3aed".'),
        team: labelTeam,
      },
    },
    async (args) => {
      const saved = await createLabel(principal, {
        name: args.name,
        color: args.color ?? DEFAULT_LABEL_COLOR,
        teamId: await labelTeamId(principal, args.team),
      });
      await publish(saved.actions);
      return {
        label: {
          id: saved.label.id,
          name: saved.label.name,
          color: saved.label.color,
          teamId: saved.label.teamId,
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'update_label',
      title: 'Update a label',
      description:
        'Rename a label, change its colour, or move it between a team and the whole workspace.',
      readOnly: false,
      inputSchema: {
        label: labelRef,
        name: z.string().trim().min(1).max(48).optional(),
        color: hexColor.optional(),
        team: labelTeam,
      },
    },
    async (args) => {
      const id = await resolveLabelId(principal, args.label);
      const saved = await updateLabel(principal, id, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.color === undefined ? {} : { color: args.color }),
        ...(args.team === undefined ? {} : { teamId: await labelTeamId(principal, args.team) }),
      });
      await publish(saved.actions);
      return {
        label: {
          id: saved.label.id,
          name: saved.label.name,
          color: saved.label.color,
          teamId: saved.label.teamId,
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_label',
      title: 'Delete a label',
      description: 'Remove a label from the workspace and from every issue carrying it.',
      readOnly: false,
      inputSchema: { label: labelRef },
    },
    async (args) => {
      const id = await resolveLabelId(principal, args.label);
      const actions = await deleteLabel(principal, id);
      await publish(actions);
      return { deleted: id };
    },
  );
}

function registerStateTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_state',
      title: 'Create a workflow state',
      description:
        'Add a status to a team board. The category drives what the product infers from it, so pick the one that matches the meaning. The new status lands at the end; use reorder_states to place it.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        name: z.string().trim().min(1).max(48).describe('Status name such as "Blocked".'),
        category: z.enum(STATE_CATEGORIES).describe('Which lifecycle stage this status means.'),
        color: hexColor.optional().describe('Hex colour such as "#7c3aed".'),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const saved = await createWorkflowState(principal, {
        teamId: team.id,
        name: args.name,
        category: args.category,
        color: args.color ?? DEFAULT_STATE_COLOR,
      });
      await publish(saved.actions);
      return {
        state: {
          id: saved.state.id,
          name: saved.state.name,
          category: saved.state.category,
          position: saved.state.position,
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'update_state',
      title: 'Update a workflow state',
      description:
        'Rename a status, recolour it, or move it to another category. Changing the category re-derives the started, completed and canceled timestamps of every issue sitting in it.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        state: stateRef,
        name: z.string().trim().min(1).max(48).optional(),
        category: z.enum(STATE_CATEGORIES).optional(),
        color: hexColor.optional(),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const stateId = await resolveStateId(principal, team.id, args.state);
      const saved = await updateWorkflowState(principal, stateId, {
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.category === undefined ? {} : { category: args.category }),
        ...(args.color === undefined ? {} : { color: args.color }),
      });
      await publish(saved.actions);
      return {
        state: {
          id: saved.state.id,
          name: saved.state.name,
          category: saved.state.category,
          position: saved.state.position,
        },
      };
    },
  );

  defineTool(
    server,
    {
      name: 'delete_state',
      title: 'Delete a workflow state',
      description:
        'Remove a status from a team board. A status that still holds issues is refused unless moveTo names another status on the same team to carry them.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        state: stateRef,
        moveTo: stateRef.optional().describe('The status the issues in it move to.'),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const stateId = await resolveStateId(principal, team.id, args.state);
      const moveToStateId =
        args.moveTo === undefined
          ? undefined
          : await resolveStateId(principal, team.id, args.moveTo);
      const actions = await deleteWorkflowState(
        principal,
        stateId,
        moveToStateId === undefined ? {} : { moveToStateId },
      );
      await publish(actions);
      return { deleted: stateId, movedIssues: actions.filter((a) => a.model === 'issue').length };
    },
  );

  defineTool(
    server,
    {
      name: 'reorder_states',
      title: 'Reorder the workflow states of a team',
      description:
        'Set the board order of a team. Name every status on the team exactly once, first column first. Call list_states to see the current order.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        order: z
          .array(stateRef)
          .min(1)
          .max(200)
          .describe('Every status on the team, in the order they should appear.'),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const stateIds: string[] = [];
      for (const ref of args.order) {
        stateIds.push(await resolveStateId(principal, team.id, ref));
      }
      const saved = await reorderWorkflowStates(principal, { teamId: team.id, stateIds });
      await publish(saved.actions);
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
}

export function registerTaxonomyTools(server: McpServer, principal: Principal): void {
  registerLabelTools(server, principal);
  registerStateTools(server, principal);
}
