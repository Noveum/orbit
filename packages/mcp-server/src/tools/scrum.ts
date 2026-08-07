import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addBlocker,
  advanceStandup,
  type CycleRow,
  completeCycle,
  createCycle,
  createMilestone,
  findStandup,
  getRotation,
  listMilestones,
  listStandups,
  type MilestoneRow,
  openBlockers,
  openStandup,
  reorderMilestones,
  resolveBlocker,
  type StandupDetail,
  setRotation,
  standupWorkload,
  startStandup,
  today,
  updateCycle,
  updateStandup,
  updateTurn,
} from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { resolveMilestone, resolveProject, resolveTeam, resolveUserId } from '../resolve.ts';
import { defineTool, publish } from './support.ts';

const teamRef = z.string().min(1).describe('Team key like "ENG", team name, or team id.');
const instant = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Use an ISO 8601 date or timestamp, such as 2031-01-05 or 2031-01-05T09:00:00Z.',
  });

const heldOn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('The day the standup is held, as YYYY-MM-DD.');

function standupView(detail: StandupDetail): Record<string, unknown> {
  return {
    id: detail.standup.id,
    teamId: detail.standup.teamId,
    heldOn: detail.standup.heldOn,
    status: detail.standup.status,
    facilitatorId: detail.standup.facilitatorId,
    currentTurnId: detail.standup.currentTurnId,
    cycleId: detail.standup.cycleId,
    turns: detail.turns.map((turn) => ({
      id: turn.id,
      userId: turn.userId,
      position: turn.position,
      status: turn.status,
      attendance: turn.attendance,
      notes: turn.notes,
      blockers: turn.blockers,
      durationSeconds: turn.durationSeconds,
    })),
    blockers: detail.blockers.map((blocker) => ({
      id: blocker.id,
      turnId: blocker.turnId,
      summary: blocker.summary,
      resolvedAt: blocker.resolvedAt?.toISOString() ?? null,
    })),
  };
}

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

function registerStandupTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'open_standup',
      title: 'Open a standup',
      description:
        'Open the standup room for a team on a day, seating every team member in rotation order. Idempotent: opening the same day twice returns the same room.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        heldOn: heldOn.optional(),
        facilitator: z.string().optional().describe('Name, email, or id of the scrum master.'),
        participants: z
          .array(z.string())
          .max(100)
          .optional()
          .describe('Names, emails, or ids to seat instead of the whole team.'),
      },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const facilitatorId =
        input.facilitator === undefined
          ? undefined
          : await resolveUserId(principal, input.facilitator);
      const participantIds =
        input.participants === undefined
          ? undefined
          : await Promise.all(input.participants.map((entry) => resolveUserId(principal, entry)));
      const result = await openStandup(principal, {
        teamId,
        ...(input.heldOn === undefined ? {} : { heldOn: input.heldOn }),
        ...(facilitatorId === undefined ? {} : { facilitatorId }),
        ...(participantIds === undefined ? {} : { participantIds }),
      });
      await publish(result.actions);
      return { standup: standupView(result.detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'get_standup',
      title: 'Get a standup',
      description:
        'Read a standup room for a team and day, including every turn, what each person said, and the open blockers.',
      readOnly: true,
      inputSchema: { team: teamRef, heldOn: heldOn.optional() },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const detail = await findStandup(principal, teamId, input.heldOn ?? today());
      return { standup: detail === null ? null : standupView(detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'list_standups',
      title: 'List standups',
      description: 'List recent standups for a team so you can review what the room covered.',
      readOnly: true,
      inputSchema: {
        team: teamRef,
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const rows = await listStandups(principal, { teamId, limit: input.limit });
      return { standups: rows };
    },
  );

  defineTool(
    server,
    {
      name: 'run_standup',
      title: 'Run the standup',
      description:
        'Drive the ceremony: start it, move to the next or previous speaker, or finish it. Use record_standup_turn to capture what somebody said before moving on.',
      readOnly: false,
      inputSchema: {
        standupId: z.string().min(1),
        action: z
          .enum(['start', 'next', 'previous', 'finish'])
          .describe('start opens the room, next and previous walk it, finish closes it.'),
        markDone: z
          .boolean()
          .default(true)
          .describe('When moving on, mark the current speaker done and bank their time.'),
      },
    },
    async (input) => {
      if (input.action === 'start') {
        const started = await startStandup(principal, input.standupId);
        await publish(started.actions);
        return { standup: standupView(started.detail) };
      }
      if (input.action === 'finish') {
        const finished = await updateStandup(principal, input.standupId, { status: 'finished' });
        await publish(finished.actions);
        return { standup: standupView(finished.detail) };
      }
      const moved = await advanceStandup(principal, input.standupId, {
        direction: input.action,
        markDone: input.markDone,
      });
      await publish(moved.actions);
      return { standup: standupView(moved.detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'record_standup_turn',
      title: 'Record a standup turn',
      description:
        'Write down what a person said in their turn, and mark whether they are present or absent.',
      readOnly: false,
      inputSchema: {
        standupId: z.string().min(1),
        turnId: z.string().min(1),
        notes: z.string().optional().describe('What they said.'),
        blockers: z.string().optional().describe('What is in their way, as free text.'),
        attendance: z.enum(['unknown', 'present', 'absent']).optional(),
      },
    },
    async (input) => {
      const result = await updateTurn(principal, input.standupId, input.turnId, {
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.blockers === undefined ? {} : { blockers: input.blockers }),
        ...(input.attendance === undefined ? {} : { attendance: input.attendance }),
      });
      await publish(result.actions);
      return { standup: standupView(result.detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'raise_blocker',
      title: 'Raise a blocker',
      description: 'Raise a blocker against somebody’s turn so it survives past the meeting.',
      readOnly: false,
      inputSchema: {
        standupId: z.string().min(1),
        turnId: z.string().min(1),
        summary: z.string().min(1).describe('What is blocked, in one line.'),
      },
    },
    async (input) => {
      const result = await addBlocker(principal, input.standupId, input.turnId, {
        summary: input.summary,
      });
      await publish(result.actions);
      return { standup: standupView(result.detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'resolve_blocker',
      title: 'Resolve a blocker',
      description: 'Close a blocker that has been cleared, or reopen one that has not.',
      readOnly: false,
      inputSchema: {
        standupId: z.string().min(1),
        blockerId: z.string().min(1),
        resolved: z.boolean().default(true),
      },
    },
    async (input) => {
      const result = await resolveBlocker(principal, input.standupId, input.blockerId, {
        resolved: input.resolved,
      });
      await publish(result.actions);
      return { standup: standupView(result.detail) };
    },
  );

  defineTool(
    server,
    {
      name: 'list_blockers',
      title: 'List open blockers',
      description: 'List every blocker a team has raised and not yet cleared.',
      readOnly: true,
      inputSchema: { team: teamRef },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      return { blockers: await openBlockers(principal, teamId) };
    },
  );

  defineTool(
    server,
    {
      name: 'standup_workload',
      title: 'Standup workload',
      description:
        'How much each person is carrying going into the standup, so you can spot who is overloaded.',
      readOnly: true,
      inputSchema: { team: teamRef, days: z.number().int().min(1).max(90).default(14) },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      return { workload: await standupWorkload(principal, teamId, since) };
    },
  );

  defineTool(
    server,
    {
      name: 'get_standup_rotation',
      title: 'Get the standup rotation',
      description: 'Read the speaking order and who is eligible to facilitate.',
      readOnly: true,
      inputSchema: { team: teamRef },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      return { rotation: await getRotation(principal, teamId) };
    },
  );

  defineTool(
    server,
    {
      name: 'set_standup_rotation',
      title: 'Set the standup rotation',
      description:
        'Set the speaking order for a team and mark who may take the scrum master seat. Everyone named has to be on the team.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        members: z
          .array(
            z.object({
              person: z.string().min(1).describe('Name, email, or id.'),
              facilitates: z.boolean().default(true),
            }),
          )
          .max(100)
          .describe('In speaking order.'),
      },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const members = await Promise.all(
        input.members.map(async (entry) => ({
          userId: await resolveUserId(principal, entry.person),
          facilitates: entry.facilitates,
        })),
      );
      const saved = await setRotation(principal, { teamId, members });
      await publish(saved.actions);
      return { rotation: saved.rotation };
    },
  );
}

function registerSprintTools(server: McpServer, principal: Principal): void {
  defineTool(
    server,
    {
      name: 'create_cycle',
      title: 'Create a sprint',
      description: 'Open a new sprint (cycle) for a team over a date range.',
      readOnly: false,
      inputSchema: {
        team: teamRef,
        name: z.string().optional(),
        startsAt: instant.describe('ISO timestamp or date the sprint opens.'),
        endsAt: instant.describe('ISO timestamp or date the sprint closes.'),
      },
    },
    async (input) => {
      const teamId = (await resolveTeam(principal, input.team)).id;
      const result = await createCycle(principal, {
        teamId,
        ...(input.name === undefined ? {} : { name: input.name }),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
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
  registerStandupTools(server, principal);
  registerSprintTools(server, principal);
  registerMilestoneTools(server, principal);
}
