import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  activeCycle,
  type CycleRow,
  createProject,
  cycleProgress,
  getIssue,
  listCycles,
  listProjects,
  type ProjectRow,
  projectProgress,
  updateIssue,
} from '@orbit/core';
import { PROJECT_HEALTHS, PROJECT_STATUSES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveCycle, resolveProject, resolveTeam, resolveUserId } from '../resolve.ts';
import { deltaViews, describeIssue } from '../views.ts';
import { defineTool, publish } from './support.ts';

const teamRef = z.string().min(1).describe('Team key like "ENG", team name, or team id.');

function projectView(row: ProjectRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    health: row.health,
    summary: row.summary,
    leadId: row.leadId,
    startDate: row.startDate,
    targetDate: row.targetDate,
    archived: row.archivedAt !== null,
  };
}

function cycleView(row: CycleRow): Record<string, unknown> {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    completed: row.completedAt !== null,
  };
}

function registerProjectTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_projects',
      title: 'List projects',
      description: 'List the projects in the workspace with their status and health.',
      readOnly: true,
      inputSchema: {
        includeArchived: z.boolean().default(false).describe('Include archived projects.'),
      },
    },
    async (args) => {
      const projects = await listProjects(principal, { includeArchived: args.includeArchived });
      return { projects: projects.map(projectView) };
    },
  );

  defineTool(
    server,
    {
      name: 'create_project',
      title: 'Create a project',
      description:
        'Create a project and optionally attach it to one or more teams. Requires a role that can manage projects.',
      readOnly: false,
      inputSchema: {
        name: z.string().min(2).max(120).describe('Project name.'),
        summary: z.string().max(500).optional().describe('One line summary.'),
        description: z.string().max(100_000).optional().describe('Markdown brief.'),
        status: z.enum(PROJECT_STATUSES).optional().describe('Delivery status.'),
        health: z.enum(PROJECT_HEALTHS).optional().describe('Current health signal.'),
        lead: z.string().min(1).optional().describe('Lead name, handle, email, id, or "me".'),
        startDate: z.iso.date().optional().describe('Start date as YYYY-MM-DD.'),
        targetDate: z.iso.date().optional().describe('Target date as YYYY-MM-DD.'),
        teams: z.array(teamRef).max(50).optional().describe('Teams that own the project.'),
      },
    },
    async (args) => {
      const teamIds: string[] = [];
      for (const ref of args.teams ?? []) teamIds.push((await resolveTeam(principal, ref)).id);
      const created = await createProject(principal, {
        name: args.name,
        teamIds,
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.health === undefined ? {} : { health: args.health }),
        ...(args.lead === undefined ? {} : { leadId: await resolveUserId(principal, args.lead) }),
        ...(args.startDate === undefined ? {} : { startDate: args.startDate }),
        ...(args.targetDate === undefined ? {} : { targetDate: args.targetDate }),
      });
      await publish(created.actions);
      return { project: projectView(created.project), deltas: deltaViews(created.actions) };
    },
  );

  defineTool(
    server,
    {
      name: 'project_progress',
      title: 'Get project progress',
      description:
        'Return the issue counts for a project, in total and per milestone, so you can report how far along it is.',
      readOnly: true,
      inputSchema: { project: z.string().min(1).describe('Project name, slug or id.') },
    },
    async (args) => {
      const project = await resolveProject(principal, args.project);
      const progress = await projectProgress(principal, project.id);
      return { project: project.name, ...progress };
    },
  );
}

function registerCycleTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'list_cycles',
      title: 'List cycles',
      description: 'List the cycles of one team in number order.',
      readOnly: true,
      inputSchema: { team: teamRef },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const cycles = await listCycles(principal, team.id);
      return { teamId: team.id, cycles: cycles.map(cycleView) };
    },
  );

  defineTool(
    server,
    {
      name: 'active_cycle',
      title: 'Get the active cycle',
      description: 'Return the cycle a team is currently running, or null when none is open.',
      readOnly: true,
      inputSchema: { team: teamRef },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const current = await activeCycle(principal, team.id);
      return { teamId: team.id, cycle: current === undefined ? null : cycleView(current) };
    },
  );

  defineTool(
    server,
    {
      name: 'cycle_progress',
      title: 'Get cycle progress',
      description:
        'Return scope, started and completed counts for a cycle plus a day by day burn up series.',
      readOnly: true,
      inputSchema: {
        team: teamRef,
        cycle: z.string().min(1).describe('Cycle name, number, id, or "active".'),
      },
    },
    async (args) => {
      const team = await resolveTeam(principal, args.team);
      const cycle = await resolveCycle(principal, team.id, args.cycle);
      const progress = await cycleProgress(principal, cycle.id);
      return { cycle: cycleView(cycle), ...progress };
    },
  );

  defineTool(
    server,
    {
      name: 'move_to_cycle',
      title: 'Move an issue into a cycle',
      description:
        'Put an issue into a cycle, or pass null to take it out of the cycle it is in. The cycle must belong to the issue team.',
      readOnly: false,
      inputSchema: {
        issue: z.string().min(1).describe('Issue identifier like "ENG-42", or an issue id.'),
        cycle: z
          .string()
          .min(1)
          .nullable()
          .describe(
            'Cycle name, number, id, "active", or null to remove the issue from its cycle.',
          ),
      },
    },
    async (args) => {
      const issue = await getIssue(principal, args.issue);
      const cycleId =
        args.cycle === null ? null : (await resolveCycle(principal, issue.teamId, args.cycle)).id;
      const updated = await updateIssue(principal, issue.id, { cycleId });
      await publish(updated.actions);
      return {
        issue: await describeIssue(principal, updated.issue),
        deltas: deltaViews(updated.actions),
      };
    },
  );
}

export function registerPlanningTools(server: McpServer, principal: Principal): void {
  registerProjectTools(server, principal);
  registerCycleTools(server, principal);
}
