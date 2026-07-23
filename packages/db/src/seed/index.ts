import { randomUUID } from 'node:crypto';
import { STATE_CATEGORY_ORDER, unique } from '@orbit/shared';
import { sql } from 'drizzle-orm';
import { db, pool } from '../client.ts';
import * as schema from '../schema/index.ts';
import {
  SEED_COLLECTIONS,
  SEED_COMMENTS,
  SEED_DOCS,
  SEED_ISSUES,
  SEED_LABELS,
  SEED_PROJECTS,
  SEED_STATES,
  SEED_TEAMS,
  SEED_USERS,
} from './data.ts';

const ORGANIZATION_ID = 'org_noveum_demo';
const ORGANIZATION_SLUG = 'noveum';
const SORT_STEP = 1024;

function id(): string {
  return randomUUID();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysAhead(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function reset(): Promise<void> {
  const tables = [
    'reaction',
    'comment',
    'attachment',
    'doc_subscription',
    'doc',
    'doc_collection',
    'favorite',
    'notification',
    'notification_preference',
    'notification_setting',
    'email_delivery',
    'audit_log',
    'api_key',
    'webhook_delivery',
    'automation_rule',
    'git_link',
    'integration_channel',
    'integration',
    'issue_activity',
    'issue_subscription',
    'issue_relation',
    'issue_label',
    'issue',
    'view',
    'milestone',
    'project_update',
    'project_team',
    'project',
    'cycle',
    'label',
    'workflow_state',
    'team_member',
    'team',
    'invitation',
    'member',
    'organization',
    'passkey',
    'account',
    'session',
    'verification',
    '"user"',
  ];
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`));
  await db.execute(sql.raw('ALTER SEQUENCE sync_id_seq RESTART WITH 1'));
}

async function seedOrganizationAndUsers(): Promise<Map<string, string>> {
  await db.insert(schema.organization).values({
    id: ORGANIZATION_ID,
    name: 'Noveum',
    slug: ORGANIZATION_SLUG,
    logo: null,
    allowedEmailDomains: ['noveum.ai'],
    createdAt: daysAgo(240),
  });

  const userIds = new Map<string, string>();
  const userRows = SEED_USERS.map((entry) => {
    const userId = id();
    userIds.set(entry.handle, userId);
    return {
      id: userId,
      name: entry.name,
      email: entry.email,
      emailVerified: true,
      image: null,
      handle: entry.handle,
      timezone: 'Asia/Kolkata',
      createdAt: daysAgo(200),
      updatedAt: daysAgo(2),
    };
  });
  await db.insert(schema.user).values(userRows);

  await db.insert(schema.member).values(
    SEED_USERS.map((entry) => ({
      id: id(),
      organizationId: ORGANIZATION_ID,
      userId: required(userIds.get(entry.handle), `missing user ${entry.handle}`),
      role: entry.role,
      syncId: 0,
      createdAt: daysAgo(200),
    })),
  );

  return userIds;
}

interface TeamRecord {
  readonly id: string;
  readonly key: string;
  readonly states: Map<string, string>;
}

async function seedTeams(userIds: Map<string, string>): Promise<Map<string, TeamRecord>> {
  const teams = new Map<string, TeamRecord>();

  for (const entry of SEED_TEAMS) {
    const teamId = id();
    await db.insert(schema.team).values({
      id: teamId,
      organizationId: ORGANIZATION_ID,
      name: entry.name,
      key: entry.key,
      description: entry.description,
      icon: entry.icon,
      color: entry.color,
      issueCounter: 0,
      syncId: 0,
      createdAt: daysAgo(200),
      updatedAt: daysAgo(5),
    });

    const states = new Map<string, string>();
    const stateRows = SEED_STATES.map((state) => {
      const stateId = id();
      states.set(state.name, stateId);
      return {
        id: stateId,
        organizationId: ORGANIZATION_ID,
        teamId,
        name: state.name,
        category: state.category,
        color: state.color,
        position: STATE_CATEGORY_ORDER[state.category],
        syncId: 0,
        createdAt: daysAgo(200),
      };
    });
    await db.insert(schema.workflowState).values(stateRows);

    teams.set(entry.key, { id: teamId, key: entry.key, states });
  }

  const memberships = SEED_USERS.flatMap((entry) =>
    entry.teams.map((teamKey) => ({
      id: id(),
      teamId: required(teams.get(teamKey), `missing team ${teamKey}`).id,
      userId: required(userIds.get(entry.handle), `missing user ${entry.handle}`),
      createdAt: daysAgo(190),
    })),
  );
  await db.insert(schema.teamMember).values(memberships);

  return teams;
}

async function seedLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const rows = SEED_LABELS.map((entry) => {
    const labelId = id();
    labels.set(entry.name, labelId);
    return {
      id: labelId,
      organizationId: ORGANIZATION_ID,
      teamId: null,
      name: entry.name,
      color: entry.color,
      syncId: 0,
      createdAt: daysAgo(200),
    };
  });
  await db.insert(schema.label).values(rows);
  return labels;
}

async function seedCycles(teams: Map<string, TeamRecord>): Promise<Map<string, string>> {
  const cycles = new Map<string, string>();
  for (const [key, team] of teams) {
    const current = id();
    cycles.set(key, current);
    await db.insert(schema.cycle).values([
      {
        id: current,
        organizationId: ORGANIZATION_ID,
        teamId: team.id,
        number: 12,
        name: '',
        startsAt: daysAgo(6),
        endsAt: daysAhead(8),
        completedAt: null,
        syncId: 0,
        createdAt: daysAgo(30),
      },
      {
        id: id(),
        organizationId: ORGANIZATION_ID,
        teamId: team.id,
        number: 13,
        name: '',
        startsAt: daysAhead(9),
        endsAt: daysAhead(23),
        completedAt: null,
        syncId: 0,
        createdAt: daysAgo(30),
      },
    ]);
  }
  return cycles;
}

interface ProjectRecord {
  readonly id: string;
  readonly milestones: Map<string, string>;
}

async function seedProjects(
  userIds: Map<string, string>,
  teams: Map<string, TeamRecord>,
): Promise<Map<string, ProjectRecord>> {
  const projects = new Map<string, ProjectRecord>();

  for (const [index, entry] of SEED_PROJECTS.entries()) {
    const projectId = id();
    await db.insert(schema.project).values({
      id: projectId,
      organizationId: ORGANIZATION_ID,
      name: entry.name,
      slug: entry.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      summary: entry.summary,
      description: `## Overview\n\n${entry.summary}\n\nProgress is tracked against the milestones below.`,
      status: entry.status,
      health: entry.health,
      icon: 'box',
      color: '#5A63C8',
      leadId: userIds.get(entry.leadHandle) ?? null,
      startDate: daysAgo(40).toISOString().slice(0, 10),
      targetDate: daysAhead(30 + index * 15)
        .toISOString()
        .slice(0, 10),
      sortOrder: (index + 1) * SORT_STEP,
      syncId: 0,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(3),
    });

    await db.insert(schema.projectTeam).values(
      entry.teams.map((teamKey) => ({
        id: id(),
        projectId,
        teamId: required(teams.get(teamKey), `missing team ${teamKey}`).id,
      })),
    );

    const milestones = new Map<string, string>();
    const milestoneRows = entry.milestones.map((name, milestoneIndex) => {
      const milestoneId = id();
      milestones.set(name, milestoneId);
      return {
        id: milestoneId,
        organizationId: ORGANIZATION_ID,
        projectId,
        name,
        description: '',
        targetDate: daysAhead(10 + milestoneIndex * 14)
          .toISOString()
          .slice(0, 10),
        sortOrder: (milestoneIndex + 1) * SORT_STEP,
        syncId: 0,
        createdAt: daysAgo(58),
      };
    });
    await db.insert(schema.milestone).values(milestoneRows);

    projects.set(entry.name, { id: projectId, milestones });
  }

  await db.insert(schema.projectUpdate).values([
    {
      id: id(),
      organizationId: ORGANIZATION_ID,
      projectId: required(projects.get('Realtime Sync Engine'), 'missing project').id,
      authorId: required(userIds.get('shashank'), 'missing user'),
      health: 'on_track',
      body: 'Delta fan out is in review and presence lands this week. Scope is holding.',
      syncId: 0,
      createdAt: daysAgo(4),
    },
    {
      id: id(),
      organizationId: ORGANIZATION_ID,
      projectId: required(projects.get('Workspace Onboarding'), 'missing project').id,
      authorId: required(userIds.get('aditi'), 'missing user'),
      health: 'at_risk',
      body: 'Passkey behavior on Safari is costing us a few days. Invite lifecycle is unaffected.',
      syncId: 0,
      createdAt: daysAgo(2),
    },
  ]);

  return projects;
}

interface IssueRecord {
  readonly id: string;
  readonly identifier: string;
  readonly teamId: string;
}

function stateTimestamps(stateName: string): {
  startedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
} {
  if (stateName === 'Done') {
    return { startedAt: daysAgo(12), completedAt: daysAgo(3), canceledAt: null };
  }
  if (stateName === 'Canceled') {
    return { startedAt: daysAgo(20), completedAt: null, canceledAt: daysAgo(9) };
  }
  if (stateName === 'In Progress' || stateName === 'In Review') {
    return { startedAt: daysAgo(7), completedAt: null, canceledAt: null };
  }
  return { startedAt: null, completedAt: null, canceledAt: null };
}

async function attachLabels(
  issueId: string,
  names: readonly string[],
  labels: Map<string, string>,
): Promise<void> {
  const rows = names
    .map((name) => labels.get(name))
    .filter((value): value is string => value !== undefined)
    .map((labelId) => ({ id: id(), issueId, labelId }));
  if (rows.length === 0) return;
  await db.insert(schema.issueLabel).values(rows);
}

async function seedIssues(
  userIds: Map<string, string>,
  teams: Map<string, TeamRecord>,
  labels: Map<string, string>,
  projects: Map<string, ProjectRecord>,
  cycles: Map<string, string>,
): Promise<Map<string, IssueRecord>> {
  const issues = new Map<string, IssueRecord>();
  const counters = new Map<string, number>();
  const columnOrders = new Map<string, number>();

  for (const [index, entry] of SEED_ISSUES.entries()) {
    const team = required(teams.get(entry.team), `missing team ${entry.team}`);
    const stateId = required(team.states.get(entry.state), `missing state ${entry.state}`);
    const nextNumber = (counters.get(entry.team) ?? 0) + 1;
    counters.set(entry.team, nextNumber);

    const columnKey = `${team.id}:${stateId}`;
    const nextOrder = (columnOrders.get(columnKey) ?? 0) + SORT_STEP;
    columnOrders.set(columnKey, nextOrder);

    const issueId = id();
    const identifier = `${team.key}-${nextNumber}`;
    const timestamps = stateTimestamps(entry.state);
    const project = entry.project === null ? null : projects.get(entry.project);
    const inCycle = timestamps.startedAt !== null && timestamps.canceledAt === null;

    await db.insert(schema.issue).values({
      id: issueId,
      organizationId: ORGANIZATION_ID,
      teamId: team.id,
      number: nextNumber,
      identifier,
      title: entry.title,
      description: entry.description,
      stateId,
      priority: entry.priority,
      creatorId: required(userIds.get('pulkit'), 'missing creator'),
      assigneeId: entry.assignee === null ? null : (userIds.get(entry.assignee) ?? null),
      projectId: project?.id ?? null,
      milestoneId:
        entry.milestone === null ? null : (project?.milestones.get(entry.milestone) ?? null),
      cycleId: inCycle ? (cycles.get(entry.team) ?? null) : null,
      parentId: null,
      estimate: entry.estimate,
      dueDate: null,
      sortOrder: nextOrder,
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      canceledAt: timestamps.canceledAt,
      stateEnteredAt: daysAgo(Math.max(1, 30 - index)),
      syncId: 0,
      createdAt: daysAgo(Math.max(2, 45 - index)),
      updatedAt: daysAgo(Math.max(1, 12 - (index % 12))),
    });

    await attachLabels(issueId, entry.labels, labels);

    issues.set(entry.title, { id: issueId, identifier, teamId: team.id });
  }

  for (const [teamKey, count] of counters) {
    const team = required(teams.get(teamKey), `missing team ${teamKey}`);
    await db
      .update(schema.team)
      .set({ issueCounter: count })
      .where(sql`${schema.team.id} = ${team.id}`);
  }

  return issues;
}

async function seedComments(
  userIds: Map<string, string>,
  issues: Map<string, IssueRecord>,
): Promise<void> {
  for (const entry of SEED_COMMENTS) {
    const issue = issues.get(entry.issueTitle);
    if (issue === undefined) continue;

    const rootId = id();
    await db.insert(schema.comment).values({
      id: rootId,
      organizationId: ORGANIZATION_ID,
      issueId: issue.id,
      authorId: required(userIds.get(entry.author), `missing user ${entry.author}`),
      parentId: null,
      body: entry.body,
      syncId: 0,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
    });

    for (const [index, reply] of entry.replies.entries()) {
      await db.insert(schema.comment).values({
        id: id(),
        organizationId: ORGANIZATION_ID,
        issueId: issue.id,
        authorId: required(userIds.get(reply.author), `missing user ${reply.author}`),
        parentId: rootId,
        body: reply.body,
        syncId: 0,
        createdAt: daysAgo(5 - index * 0.1),
        updatedAt: daysAgo(5 - index * 0.1),
      });
    }

    const reactionRows = entry.reactions
      .map((reaction) => {
        const userId = userIds.get(reaction.user);
        if (userId === undefined) return null;
        return {
          id: id(),
          organizationId: ORGANIZATION_ID,
          commentId: rootId,
          issueId: null,
          userId,
          emoji: reaction.emoji,
          syncId: 0,
          createdAt: daysAgo(4),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (reactionRows.length > 0) await db.insert(schema.reaction).values(reactionRows);
  }
}

async function seedDocs(
  userIds: Map<string, string>,
  projects: Map<string, ProjectRecord>,
): Promise<void> {
  const collections = new Map<string, string>();
  const collectionRows = SEED_COLLECTIONS.map((name) => {
    const collectionId = id();
    collections.set(name, collectionId);
    return {
      id: collectionId,
      organizationId: ORGANIZATION_ID,
      name,
      icon: 'book',
      createdAt: daysAgo(120),
    };
  });
  await db.insert(schema.docCollection).values(collectionRows);

  const docRows = await db
    .insert(schema.doc)
    .values(
      SEED_DOCS.map((entry) => ({
        id: id(),
        organizationId: ORGANIZATION_ID,
        collectionId:
          entry.collection === null ? null : (collections.get(entry.collection) ?? null),
        projectId: entry.project === undefined ? null : (projects.get(entry.project)?.id ?? null),
        title: entry.title,
        content: entry.content,
        visibility: 'workspace',
        publishToken: null,
        authorId: required(userIds.get(entry.author), `missing user ${entry.author}`),
        repoBinding:
          entry.repoBinding === undefined
            ? null
            : { ...entry.repoBinding, syncedAt: daysAgo(1).toISOString() },
        syncId: 0,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(3),
      })),
    )
    .returning({ id: schema.doc.id, authorId: schema.doc.authorId });

  const watchers = [...userIds.values()].slice(0, 3);
  await db.insert(schema.docSubscription).values(
    docRows.flatMap((row) =>
      unique([row.authorId, ...watchers]).map((userId) => ({
        id: id(),
        docId: row.id,
        userId,
        muted: false,
      })),
    ),
  );
}

async function seedNotifications(
  userIds: Map<string, string>,
  issues: Map<string, IssueRecord>,
): Promise<void> {
  const recipient = required(userIds.get('pulkit'), 'missing user');
  const actor = required(userIds.get('shashank'), 'missing user');
  const entries = [...issues.values()].slice(0, 6);

  await db.insert(schema.notification).values(
    entries.map((issue, index) => ({
      id: id(),
      organizationId: ORGANIZATION_ID,
      userId: recipient,
      type: index % 2 === 0 ? 'issue_assigned' : 'comment_created',
      actorType: 'user',
      actorId: actor,
      actorName: 'Shashank Agarwal',
      entityType: 'issue',
      entityId: issue.id,
      title:
        index % 2 === 0 ? `Assigned you ${issue.identifier}` : `Commented on ${issue.identifier}`,
      body: '',
      url: `/issue/${issue.identifier}`,
      readAt: index > 2 ? daysAgo(1) : null,
      snoozedUntil: null,
      deliveredChannels: ['inbox'],
      syncId: 0,
      createdAt: daysAgo(index + 1),
    })),
  );
}

async function main(): Promise<void> {
  console.info('Resetting database');
  await reset();

  console.info('Seeding organization and users');
  const userIds = await seedOrganizationAndUsers();

  console.info('Seeding teams and workflow states');
  const teams = await seedTeams(userIds);

  console.info('Seeding labels and cycles');
  const labels = await seedLabels();
  const cycles = await seedCycles(teams);

  console.info('Seeding projects and milestones');
  const projects = await seedProjects(userIds, teams);

  console.info('Seeding issues');
  const issues = await seedIssues(userIds, teams, labels, projects, cycles);

  console.info('Seeding comments and reactions');
  await seedComments(userIds, issues);

  console.info('Seeding docs');
  await seedDocs(userIds, projects);

  console.info('Seeding notifications');
  await seedNotifications(userIds, issues);

  console.info(
    `Done. ${SEED_USERS.length} users, ${SEED_TEAMS.length} teams, ${issues.size} issues, ${SEED_DOCS.length} docs.`,
  );
  console.info(
    `Sign in as ${SEED_USERS[0]?.email ?? 'pulkit@noveum.ai'} to explore the workspace.`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed', error);
    await pool.end();
    process.exit(1);
  });
