import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { mockSession } from '../../../tests-support.ts';

const coreModule = await import('@orbit/core');

interface BoardStub {
  since: Date;
  issues: { id: string; title: string; assigneeId: string }[];
  workload: { userId: string; open: number; inProgress: number; completedSince: number }[];
}

const SINCE = new Date('2030-06-10T08:00:00.000Z');

const board: BoardStub = { since: SINCE, issues: [], workload: [] };
const received: unknown[] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  standupBoard: (_principal: Principal, input: unknown) => {
    received.push(input);
    return Promise.resolve(board);
  },
}));

const seeded = {
  organizationId: `org_${randomUUID()}`,
  userId: `user_${randomUUID()}`,
  teamId: `team_${randomUUID()}`,
  stateId: `state_${randomUUID()}`,
  labelledIssueId: `issue_${randomUUID()}`,
  plainIssueId: `issue_${randomUUID()}`,
  bugLabelId: `label_${randomUUID()}`,
  uiLabelId: `label_${randomUUID()}`,
};

async function seedIssuesWithLabels(): Promise<void> {
  await db.insert(schema.organization).values({
    id: seeded.organizationId,
    name: 'Standup board',
    slug: seeded.organizationId,
  });
  await db.insert(schema.user).values({
    id: seeded.userId,
    name: 'Board Author',
    email: `${seeded.userId}@orbit.test`,
    handle: seeded.userId,
  });
  await db.insert(schema.team).values({
    id: seeded.teamId,
    organizationId: seeded.organizationId,
    name: 'Board',
    key: seeded.teamId.slice(5, 10).toUpperCase(),
  });
  await db.insert(schema.workflowState).values({
    id: seeded.stateId,
    organizationId: seeded.organizationId,
    teamId: seeded.teamId,
    name: 'Todo',
    category: 'unstarted',
    color: '#5A63C8',
  });
  await db.insert(schema.issue).values([
    {
      id: seeded.labelledIssueId,
      organizationId: seeded.organizationId,
      teamId: seeded.teamId,
      number: 1,
      identifier: `BRD-${seeded.labelledIssueId.slice(6, 12)}`,
      title: 'Ship the importer',
      stateId: seeded.stateId,
      creatorId: seeded.userId,
    },
    {
      id: seeded.plainIssueId,
      organizationId: seeded.organizationId,
      teamId: seeded.teamId,
      number: 2,
      identifier: `BRD-${seeded.plainIssueId.slice(6, 12)}`,
      title: 'Fix the socket',
      stateId: seeded.stateId,
      creatorId: seeded.userId,
    },
  ]);
  await db.insert(schema.label).values([
    {
      id: seeded.bugLabelId,
      organizationId: seeded.organizationId,
      name: `Bug ${seeded.bugLabelId.slice(6, 12)}`,
      color: '#E5484D',
    },
    {
      id: seeded.uiLabelId,
      organizationId: seeded.organizationId,
      name: `Ui ${seeded.uiLabelId.slice(6, 12)}`,
      color: '#3E63DD',
    },
  ]);
  await db.insert(schema.member).values({
    id: `member_${randomUUID()}`,
    organizationId: seeded.organizationId,
    userId: seeded.userId,
    role: 'admin',
  });
  await db
    .insert(schema.teamMember)
    .values({ id: `tm_${randomUUID()}`, teamId: seeded.teamId, userId: seeded.userId });
}

const session = {
  user: { id: seeded.userId, name: 'Board Author', email: `${seeded.userId}@orbit.test` },
  session: { activeOrganizationId: seeded.organizationId },
};
const sessionHolder: { value: typeof session | null } = { value: session };

mockSession(() => sessionHolder.value);

const { GET } = await import('../../../src/app/api/standup/board/route.ts');

const payloadSchema = z.object({
  since: z.string(),
  issues: z.array(z.object({ id: z.string(), labelIds: z.array(z.string()) })),
  workload: z.array(
    z.object({
      userId: z.string(),
      open: z.number(),
      inProgress: z.number(),
      completedSince: z.number(),
    }),
  ),
});

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

const BASE = 'http://localhost:3000/api/standup/board';

beforeAll(async () => {
  await seedIssuesWithLabels();
});

beforeEach(async () => {
  sessionHolder.value = session;
  board.since = SINCE;
  board.issues = [
    { id: seeded.labelledIssueId, title: 'Ship the importer', assigneeId: 'user_2' },
    { id: seeded.plainIssueId, title: 'Fix the socket', assigneeId: 'user_2' },
  ];
  board.workload = [{ userId: 'user_2', open: 2, inProgress: 1, completedSince: 3 }];
  await db.delete(schema.issueLabel).where(eq(schema.issueLabel.issueId, seeded.labelledIssueId));
  received.length = 0;
});

afterAll(async () => {
  mock.module('@orbit/core', () => coreModule);
  await db.delete(schema.organization).where(eq(schema.organization.id, seeded.organizationId));
  await db.delete(schema.user).where(eq(schema.user.id, seeded.userId));
});

describe('GET /api/standup/board', () => {
  it('hands the query string to the service and answers with the board', async () => {
    const response = await GET(
      new Request(`${BASE}?since=${SINCE.toISOString()}&limitPerPerson=5`),
    );
    const payload = payloadSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(received).toEqual([{ since: SINCE.toISOString(), limitPerPerson: 5 }]);
    expect(payload.since).toBe(SINCE.toISOString());
    expect(payload.issues.map((issue) => issue.id)).toEqual([
      seeded.labelledIssueId,
      seeded.plainIssueId,
    ]);
    expect(payload.workload).toEqual([
      { userId: 'user_2', open: 2, inProgress: 1, completedSince: 3 },
    ]);
  });

  it('attaches the labels of every issue it returns', async () => {
    await db.insert(schema.issueLabel).values([
      {
        id: `issue_label_${randomUUID()}`,
        issueId: seeded.labelledIssueId,
        labelId: seeded.bugLabelId,
      },
      {
        id: `issue_label_${randomUUID()}`,
        issueId: seeded.labelledIssueId,
        labelId: seeded.uiLabelId,
      },
    ]);

    const response = await GET(new Request(BASE));
    const payload = payloadSchema.parse(await response.json());

    expect([...(payload.issues[0]?.labelIds ?? [])].sort()).toEqual(
      [seeded.bugLabelId, seeded.uiLabelId].sort(),
    );
    expect(payload.issues[1]?.labelIds).toEqual([]);
  });

  it('never borrows a label from an issue the board did not return', async () => {
    await db.insert(schema.issueLabel).values([
      {
        id: `issue_label_${randomUUID()}`,
        issueId: seeded.labelledIssueId,
        labelId: seeded.bugLabelId,
      },
    ]);
    board.issues = [{ id: seeded.plainIssueId, title: 'Fix the socket', assigneeId: 'user_2' }];

    const response = await GET(new Request(BASE));
    const payload = payloadSchema.parse(await response.json());

    expect(payload.issues).toHaveLength(1);
    expect(payload.issues[0]?.labelIds).toEqual([]);
  });

  it('falls back to the service defaults when no query string is sent', async () => {
    await GET(new Request(BASE));
    expect(received).toEqual([{ limitPerPerson: 25 }]);
  });

  it('answers 422 when since is not an instant', async () => {
    const response = await GET(new Request(`${BASE}?since=yesterday`));

    expect(response.status).toBe(422);
    expect(errorSchema.parse(await response.json()).error.code).toBe('validation_failed');
  });

  it('answers 422 when the per person cap is out of range', async () => {
    const response = await GET(new Request(`${BASE}?limitPerPerson=0`));
    expect(response.status).toBe(422);
  });

  it('answers 401 when nobody is signed in', async () => {
    sessionHolder.value = null;

    const response = await GET(new Request(BASE));

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });
});
