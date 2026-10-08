import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { mockMembership, mockSession } from '../../../../tests-support.ts';

const coreModule = await import('@orbit/core');

interface DuplicateCall {
  readonly projectId: string;
  readonly input: unknown;
}

const calls: DuplicateCall[] = [];
const published: SyncAction[][] = [];

const copy = {
  id: 'project_copy',
  organizationId: 'org_1',
  name: 'Platform (copy)',
  slug: 'platform-copy',
  summary: 'Core infra',
  description: 'Detailed scope',
  status: 'planned' as const,
  health: 'no_update' as const,
  leadId: null,
  startDate: '2025-02-01',
  targetDate: '2025-03-01',
  icon: null,
  color: null,
  syncId: 10,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  archivedAt: null,
};

const action = {
  syncId: 10,
  organizationId: 'org_1',
  scopes: ['project:project_copy'],
  action: 'insert',
  model: 'project',
  modelId: 'project_copy',
  data: copy,
} as unknown as SyncAction;

mock.module('@orbit/core', () => ({
  ...coreModule,
  duplicateProject: (_principal: Principal, projectId: string, input: unknown) => {
    calls.push({ projectId, input });
    return Promise.resolve({ project: copy, actions: [action] });
  },
  publishDeltas: (actions: SyncAction[]) => {
    published.push(actions);
    return Promise.resolve();
  },
}));

const session = {
  user: { id: 'user_1', name: 'Ada Admin', email: 'ada@orbit.test' },
  session: { activeOrganizationId: 'org_1' },
};

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mockSession(() => session);

const principal: Principal = {
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'member',
  teamIds: ['team_1'],
};

mockMembership(() => ({
  principal,
  memberId: 'member_1',
  organizationName: 'Nova',
  organizationSlug: 'nova',
  deletionRequestedAt: null,
}));

const { POST } = await import('../../../../src/app/api/projects/[id]/duplicate/route.ts');

const payloadSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    startDate: z.string().nullable(),
    targetDate: z.string().nullable(),
  }),
});

beforeEach(() => {
  calls.length = 0;
  published.length = 0;
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

function request(body?: unknown): Request {
  return new Request('http://localhost:3000/api/projects/project_1/duplicate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

describe('POST /api/projects/[id]/duplicate', () => {
  it('duplicates the project named in the path and answers with the copy', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'project_1' }) });
    const payload = payloadSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ projectId: 'project_1', input: {} }]);
    expect(payload.project.id).toBe('project_copy');
    expect(payload.project.name).toBe('Platform (copy)');
    expect(payload.project.slug).toBe('platform-copy');
  });

  it('hands supplied options through to the service', async () => {
    const options = {
      name: 'Platform Next',
      shiftDays: 14,
      includeIssues: false,
    };
    await POST(request(options), { params: Promise.resolve({ id: 'project_1' }) });

    expect(calls).toEqual([{ projectId: 'project_1', input: options }]);
  });

  it('fans the duplicated project actions out to realtime', async () => {
    await POST(request(), { params: Promise.resolve({ id: 'project_1' }) });

    expect(published).toEqual([[action]]);
  });
});
