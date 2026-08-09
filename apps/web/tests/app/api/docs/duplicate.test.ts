import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { mockMembership, mockSession } from '../../../../tests-support.ts';

const coreModule = await import('@orbit/core');

interface DuplicateCall {
  readonly docId: string;
  readonly input: unknown;
}

const calls: DuplicateCall[] = [];
const published: SyncAction[][] = [];

const copy = {
  id: 'doc_copy',
  organizationId: 'org_1',
  collectionId: null,
  projectId: null,
  parentId: null,
  title: 'Runbook (copy)',
  slug: 'runbook-copy',
  content: 'Steps.',
  sortOrder: 0,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 7,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  archivedAt: null,
};

const action = {
  syncId: 7,
  organizationId: 'org_1',
  scopes: ['doc:doc_copy'],
  action: 'insert',
  model: 'doc',
  modelId: 'doc_copy',
  data: {},
} as unknown as SyncAction;

mock.module('@orbit/core', () => ({
  ...coreModule,
  duplicateDoc: (_principal: Principal, docId: string, input: unknown) => {
    calls.push({ docId, input });
    return Promise.resolve({ doc: copy, actions: [action] });
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

const { POST } = await import('../../../../src/app/api/docs/[id]/duplicate/route.ts');

const payloadSchema = z.object({ doc: z.object({ id: z.string(), title: z.string() }) });

beforeEach(() => {
  calls.length = 0;
  published.length = 0;
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

function request(body?: unknown): Request {
  return new Request('http://localhost:3000/api/docs/doc_1/duplicate', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('POST /api/docs/[id]/duplicate', () => {
  it('duplicates the doc named in the path and answers with the copy', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'doc_1' }) });
    const payload = payloadSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ docId: 'doc_1', input: {} }]);
    expect(payload.doc.id).toBe('doc_copy');
    expect(payload.doc.title).toBe('Runbook (copy)');
  });

  it('hands a supplied title through to the service', async () => {
    await POST(request({ title: 'Weekly notes' }), { params: Promise.resolve({ id: 'doc_1' }) });

    expect(calls).toEqual([{ docId: 'doc_1', input: { title: 'Weekly notes' } }]);
  });

  it('fans the new doc out to everyone watching', async () => {
    await POST(request(), { params: Promise.resolve({ id: 'doc_1' }) });

    expect(published).toEqual([[action]]);
  });
});
