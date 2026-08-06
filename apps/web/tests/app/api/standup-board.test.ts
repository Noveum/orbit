import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';

const coreModule = await import('@orbit/core');
const dbModule = await import('@orbit/db');

interface BoardStub {
  since: Date;
  issues: { id: string; title: string; assigneeId: string }[];
  workload: { userId: string; open: number; inProgress: number; completedSince: number }[];
}

const SINCE = new Date('2030-06-10T08:00:00.000Z');

const board: BoardStub = { since: SINCE, issues: [], workload: [] };
const labelLinks: { issueId: string; labelId: string }[] = [];
const received: unknown[] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  standupBoard: (_principal: Principal, input: unknown) => {
    received.push(input);
    return Promise.resolve(board);
  },
}));

mock.module('@orbit/db', () => ({
  ...dbModule,
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(labelLinks) }) }) },
}));

const session = {
  user: { id: 'user_1', name: 'Ada Admin', email: 'ada@orbit.test' },
  session: { activeOrganizationId: 'org_1' },
};
const sessionHolder: { value: typeof session | null } = { value: session };

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(sessionHolder.value),
  requireSession: () => Promise.resolve(sessionHolder.value),
}));

const principal: Principal = {
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'admin',
  teamIds: ['team_1'],
};

mock.module('@/lib/auth/principal.ts', () => ({
  resolveMembership: () =>
    Promise.resolve({
      principal,
      memberId: 'member_1',
      organizationName: 'Nova',
      organizationSlug: 'nova',
    }),
}));

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

beforeEach(() => {
  sessionHolder.value = session;
  board.since = SINCE;
  board.issues = [
    { id: 'issue_1', title: 'Ship the importer', assigneeId: 'user_2' },
    { id: 'issue_2', title: 'Fix the socket', assigneeId: 'user_2' },
  ];
  board.workload = [{ userId: 'user_2', open: 2, inProgress: 1, completedSince: 3 }];
  labelLinks.length = 0;
  received.length = 0;
});

afterAll(() => {
  mock.module('@orbit/db', () => dbModule);
  mock.module('@orbit/core', () => coreModule);
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
    expect(payload.issues.map((issue) => issue.id)).toEqual(['issue_1', 'issue_2']);
    expect(payload.workload).toEqual([
      { userId: 'user_2', open: 2, inProgress: 1, completedSince: 3 },
    ]);
  });

  it('attaches the labels of every issue it returns', async () => {
    labelLinks.push(
      { issueId: 'issue_1', labelId: 'label_bug' },
      { issueId: 'issue_1', labelId: 'label_ui' },
    );

    const response = await GET(new Request(BASE));
    const payload = payloadSchema.parse(await response.json());

    expect(payload.issues[0]?.labelIds).toEqual(['label_bug', 'label_ui']);
    expect(payload.issues[1]?.labelIds).toEqual([]);
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
