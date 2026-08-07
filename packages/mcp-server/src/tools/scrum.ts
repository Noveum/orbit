import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type CycleRow,
  completeCycle,
  createCycle,
  createMilestone,
  listMilestones,
  type MilestoneRow,
  reorderMilestones,
  startCycle,
  updateCycle,
} from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveMilestone, resolveProject, resolveTeam } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const teamRef = z.string().min(1).describe('Team key like "ENG", team name, or team id.');
const instant = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Use an ISO 8601 date or timestamp, such as 2031-01-05 or 2031-01-05T09:00:00Z.',
  });

function cycleView(row: CycleRow): Record<string, unknown> {
  return {
    id: row.id,
    teamId: row.teamId,
    number: row.number,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    completed: row.completedAt !== null,
  };
}

function milestoneView(row: MilestoneRow): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate,
    sortOrder: row.sortOrder,
  };
}

function registerSprintTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_cycle',
      title: 'Create a sprint',
      description:
        'Open a new sprint (cycle) for a team over a date range. Send neither date and the server appends a two week sprint straight after the last one the team has.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        name: z.string().optional(),
        startsAt: instant
          .optional()
          .describe('ISO timestamp or date the sprint opens. Defaults to after the last sprint.'),
        endsAt: instant
          .optional()
          .describe(
            'ISO timestamp or date the sprint closes. Defaults to two weeks after it opens.',
          ),
      },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const result = await createCycle(principal, {
        teamId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      });
      await publish(result.actions);
      return { cycle: cycleView(result.cycle) };
    },
  );

  defineTool(
    server,
    {
      name: 'update_cycle',
      title: 'Update a sprint',
      description: 'Rename a sprint or move its dates.',
      readOnly: false,
      inputSchema: {
        cycleId: z.string().min(1),
        name: z.string().optional(),
        startsAt: instant.optional(),
        endsAt: instant.optional(),
      },
    },
    async (input) => {
      const result = await updateCycle(principal, input.cycleId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      });
      await publish(result.actions);
      return { cycle: cycleView(result.cycle) };
    },
  );

  defineTool(
    server,
    {
      name: 'start_cycle',
      title: 'Start a sprint',
      description:
        'Start a sprint that has not begun yet, by pulling its start date to now. A sprint has no separate started flag: it runs whenever the clock sits inside its dates and it has not been completed. The sprint keeps its planned end date, and the team has to have no sprint running.',
      readOnly: false,
      inputSchema: { cycleId: z.string().min(1) },
    },
    async (input) => {
      const result = await startCycle(principal, input.cycleId);
      await publish(result.actions);
      return { cycle: cycleView(result.cycle) };
    },
  );

  defineTool(
    server,
    {
      name: 'complete_cycle',
      title: 'Complete a sprint',
      description:
        'Close a sprint. Whatever is unfinished rolls into the next sprint rather than being left behind.',
      readOnly: false,
      inputSchema: { cycleId: z.string().min(1) },
    },
    async (input) => {
      const result = await completeCycle(principal, input.cycleId);
      await publish(result.actions);
      return {
        cycle: cycleView(result.cycle),
        nextCycle: cycleView(result.nextCycle),
        rolledOverIssueIds: result.rolledOverIssueIds,
      };
    },
  );
}

function registerMilestoneTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_milestones',
      title: 'List milestones',
      description: 'List the milestones on a project in order.',
      readOnly: true,
      inputSchema: { project: z.string().min(1).describe('Project name, slug, or id.') },
    },
    async (input) => {
      const projectId = (await resolveProject(principal, input.project)).id;
      const rows = await listMilestones(principal, projectId);
      return { milestones: rows.map(milestoneView) };
    },
  );

  defineTool(
    server,
    {
      name: 'create_milestone',
      title: 'Create a milestone',
      description: 'Add a milestone to a project so work can be grouped towards a date.',
      readOnly: false,
      inputSchema: {
        project: z.string().min(1).describe('Project name, slug, or id.'),
        name: z.string().min(1),
        description: z.string().optional(),
        targetDate: z.string().optional().describe('YYYY-MM-DD.'),
      },
    },
    async (input) => {
      const projectId = (await resolveProject(principal, input.project)).id;
      const result = await createMilestone(principal, {
        projectId,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate }),
      });
      await publish(result.actions);
      return { milestone: milestoneView(result.milestone) };
    },
  );

  defineTool(
    server,
    {
      name: 'reorder_milestones',
      title: 'Reorder the milestones on a project',
      description:
        'Put the milestones of a project into the order given. The list has to name every milestone on the project exactly once, so read them with list_milestones first.',
      readOnly: false,
      inputSchema: {
        project: z.string().min(1).describe('Project name, slug, or id.'),
        milestones: z
          .array(z.string().min(1))
          .min(1)
          .max(200)
          .describe('Every milestone on the project, by name or id, in the order you want.'),
      },
    },
    async (input) => {
      const projectId = (await resolveProject(principal, input.project)).id;
      const ordered: string[] = [];
      for (const ref of input.milestones) {
        ordered.push((await resolveMilestone(principal, projectId, ref)).id);
      }
      const result = await reorderMilestones(principal, projectId, ordered);
      await publish(result.actions);
      return { milestones: result.milestones.map(milestoneView) };
    },
  );
}

export function registerScrumTools(server: McpServer, principal: Principal): void {
  registerSprintTools(server, principal);
  registerMilestoneTools(server, principal);
}
