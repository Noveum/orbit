import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createIssue, createLabel } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

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

interface StubSession {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

const sessionHolder: { value: StubSession | null } = { value: null };

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(sessionHolder.value),
  requireSession: () => Promise.resolve(sessionHolder.value),
}));

const { GET } = await import('../../../src/app/api/standup/board/route.ts');

let workspace: Workspace;
let firstIssueId: string;
let secondIssueId: string;
let bugLabelId: string;
let uiLabelId: string;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const first = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Ship the importer',
  });
  firstIssueId = first.issue.id;
  const second = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Fix the socket',
  });
  secondIssueId = second.issue.id;

  const bug = await createLabel(workspace.admin, { name: 'Bugbear', color: '#ff0000' });
  bugLabelId = bug.label.id;
  const surface = await createLabel(workspace.admin, { name: 'Surface', color: '#00ff00' });
  uiLabelId = surface.label.id;
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

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

beforeEach(async () => {
  sessionHolder.value = {
    user: {
      id: workspace.adminUser.id,
      name: workspace.adminUser.name,
      email: workspace.adminUser.email,
    },
    session: { activeOrganizationId: workspace.organizationId },
  };
  board.since = SINCE;
  board.issues = [
    { id: firstIssueId, title: 'Ship the importer', assigneeId: workspace.adminUser.id },
    { id: secondIssueId, title: 'Fix the socket', assigneeId: workspace.adminUser.id },
  ];
  board.workload = [{ userId: workspace.adminUser.id, open: 2, inProgress: 1, completedSince: 3 }];
  received.length = 0;
  await db.delete(schema.issueLabel);
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
    expect(payload.issues.map((issue) => issue.id)).toEqual([firstIssueId, secondIssueId]);
    expect(payload.workload).toEqual([
      { userId: workspace.adminUser.id, open: 2, inProgress: 1, completedSince: 3 },
    ]);
  });

  it('attaches the labels every issue actually carries', async () => {
    await db.insert(schema.issueLabel).values([
      { id: randomUUIDv7(), issueId: firstIssueId, labelId: bugLabelId },
      { id: randomUUIDv7(), issueId: firstIssueId, labelId: uiLabelId },
    ]);

    const response = await GET(new Request(BASE));
    const payload = payloadSchema.parse(await response.json());

    expect(payload.issues[0]?.labelIds.slice().sort()).toEqual([bugLabelId, uiLabelId].sort());
    expect(payload.issues[1]?.labelIds).toEqual([]);
  });

  it('never borrows a label from an issue the board did not return', async () => {
    await db
      .insert(schema.issueLabel)
      .values([{ id: randomUUIDv7(), issueId: secondIssueId, labelId: bugLabelId }]);
    board.issues = [
      { id: firstIssueId, title: 'Ship the importer', assigneeId: workspace.adminUser.id },
    ];

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
