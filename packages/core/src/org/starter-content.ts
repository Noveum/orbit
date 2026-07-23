import { eq, schema, sql } from '@orbit/db';
import type { Actor, SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { issueIdentifier, slugify } from '@orbit/shared/utils';
import { type Executor, newId } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import type { CycleRow } from '../work/cycle-service.ts';
import type { WorkflowStateRow } from '../work/workflow-state-service.ts';

interface SeedParams {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly team: { readonly id: string; readonly key: string };
  readonly creatorId: string;
  readonly states: readonly WorkflowStateRow[];
  readonly cycle: CycleRow;
  readonly syncId: number;
  readonly actor: Actor;
}

interface StarterIssue {
  readonly title: string;
  readonly description: string;
  readonly category: WorkflowStateRow['category'];
  readonly priority: number;
  readonly assignToCreator: boolean;
  readonly inProject: boolean;
  readonly inCycle: boolean;
}

const STARTER_ISSUES: readonly StarterIssue[] = [
  {
    title: 'Welcome to Orbit',
    description:
      'This is your first issue. Open it, edit the title, and drag it across the board. Everything you change here updates live for everyone in the workspace.',
    category: 'unstarted',
    priority: 2,
    assignToCreator: true,
    inProject: true,
    inCycle: true,
  },
  {
    title: 'Invite your teammates',
    description:
      'Orbit is better with your team. Add people from Settings, or press G then M to jump to My issues and share the link.',
    category: 'unstarted',
    priority: 2,
    assignToCreator: true,
    inProject: false,
    inCycle: true,
  },
  {
    title: 'Press C to create an issue from anywhere',
    description: 'Orbit is keyboard first. Press C to create, then Cmd Enter to save.',
    category: 'backlog',
    priority: 0,
    assignToCreator: false,
    inProject: false,
    inCycle: false,
  },
  {
    title: 'Try the board and the list layout',
    description:
      'Switch between board and list from the display menu. Your choice is remembered per view.',
    category: 'started',
    priority: 1,
    assignToCreator: true,
    inProject: true,
    inCycle: true,
  },
  {
    title: 'Group work into projects and cycles',
    description:
      'Projects hold a body of work with a lead and a target date. Cycles are time boxes. Both live in the sidebar.',
    category: 'backlog',
    priority: 3,
    assignToCreator: false,
    inProject: true,
    inCycle: false,
  },
  {
    title: 'Set a priority, an estimate, and a due date',
    description:
      'Use the properties on the right of an issue. Press P for priority and S for status.',
    category: 'unstarted',
    priority: 3,
    assignToCreator: false,
    inProject: false,
    inCycle: false,
  },
  {
    title: 'Explore keyboard shortcuts with ?',
    description: 'Press ? anywhere to see every shortcut. Almost nothing here needs the mouse.',
    category: 'completed',
    priority: 2,
    assignToCreator: true,
    inProject: false,
    inCycle: false,
  },
];

function stateFor(
  states: readonly WorkflowStateRow[],
  category: WorkflowStateRow['category'],
): WorkflowStateRow {
  const match = states.find((state) => state.category === category);
  const fallback = states.find((state) => state.category === 'unstarted') ?? states[0];
  const chosen = match ?? fallback;
  if (chosen === undefined) throw new Error('The workspace has no workflow states to seed into.');
  return chosen;
}

const WELCOME_DOC = (organizationName: string): string =>
  [
    `# Welcome to ${organizationName}`,
    '',
    'This workspace is ready to go. Here is how to make it yours.',
    '',
    '## First steps',
    '',
    '- Open the **Welcome to Orbit** issue and move it across the board.',
    '- Invite your teammates from Settings so changes show up live for everyone.',
    '- Press `C` to create an issue, `Cmd K` for the command palette, and `?` for every shortcut.',
    '',
    '## How Orbit is organised',
    '',
    '| Concept | What it is |',
    '| --- | --- |',
    '| Team | A group with its own key, board, and workflow states |',
    '| Project | A body of work with a lead and a target date |',
    '| Cycle | A time box you pull issues into |',
    '| Doc | A markdown page like this one, live and shareable |',
    '',
    'Delete anything you do not need. Nothing here is precious.',
  ].join('\n');

export async function seedStarterContent(
  executor: Executor,
  params: SeedParams,
): Promise<{ actions: SyncAction[] }> {
  const actions: SyncAction[] = [];

  const projectId = newId();
  const [project] = await executor
    .insert(schema.project)
    .values({
      id: projectId,
      organizationId: params.organizationId,
      name: 'Getting started',
      slug: slugify(`getting-started-${params.team.key}`),
      summary: 'A starter project to show how work is organised in Orbit.',
      status: 'in_progress',
      health: 'on_track',
      leadId: params.creatorId,
      syncId: params.syncId,
    })
    .returning();
  if (project !== undefined) {
    await executor
      .insert(schema.projectTeam)
      .values({ id: newId(), projectId: project.id, teamId: params.team.id });
    actions.push(
      buildSyncAction({
        syncId: params.syncId,
        organizationId: params.organizationId,
        scopes: [
          scopes.organization(params.organizationId),
          scopes.team(params.team.id),
          scopes.project(project.id),
        ],
        action: 'insert',
        model: 'project',
        modelId: project.id,
        data: project,
        actor: params.actor,
      }),
    );
  }

  const docId = newId();
  const [doc] = await executor
    .insert(schema.doc)
    .values({
      id: docId,
      organizationId: params.organizationId,
      title: `Welcome to ${params.organizationName}`,
      content: WELCOME_DOC(params.organizationName),
      visibility: 'workspace',
      authorId: params.creatorId,
      syncId: params.syncId,
    })
    .returning();
  if (doc !== undefined) {
    actions.push(
      buildSyncAction({
        syncId: params.syncId,
        organizationId: params.organizationId,
        scopes: [scopes.organization(params.organizationId), scopes.doc(doc.id)],
        action: 'insert',
        model: 'doc',
        modelId: doc.id,
        data: { ...doc, publishToken: null },
        actor: params.actor,
      }),
    );
  }

  const now = new Date();
  for (const [index, seed] of STARTER_ISSUES.entries()) {
    const number = index + 1;
    const state = stateFor(params.states, seed.category);
    const issueId = newId();
    const [issue] = await executor
      .insert(schema.issue)
      .values({
        id: issueId,
        organizationId: params.organizationId,
        teamId: params.team.id,
        number,
        identifier: issueIdentifier(params.team.key, number),
        title: seed.title,
        description: seed.description,
        stateId: state.id,
        priority: seed.priority,
        creatorId: params.creatorId,
        assigneeId: seed.assignToCreator ? params.creatorId : null,
        projectId: seed.inProject ? projectId : null,
        cycleId: seed.inCycle ? params.cycle.id : null,
        sortOrder: number * 1024,
        ...(state.category === 'started' || state.category === 'review' ? { startedAt: now } : {}),
        ...(state.category === 'completed' ? { startedAt: now, completedAt: now } : {}),
        syncId: params.syncId,
      })
      .returning();
    if (issue === undefined) continue;
    const issueScopes = [
      scopes.organization(params.organizationId),
      scopes.team(params.team.id),
      scopes.issue(issue.id),
    ];
    if (issue.projectId !== null) issueScopes.push(scopes.project(issue.projectId));
    actions.push(
      buildSyncAction({
        syncId: params.syncId,
        organizationId: params.organizationId,
        scopes: issueScopes,
        action: 'insert',
        model: 'issue',
        modelId: issue.id,
        data: issue,
        actor: params.actor,
      }),
    );
  }

  await executor
    .update(schema.team)
    .set({ issueCounter: sql`${schema.team.issueCounter} + ${STARTER_ISSUES.length}` })
    .where(eq(schema.team.id, params.team.id));

  return { actions };
}
