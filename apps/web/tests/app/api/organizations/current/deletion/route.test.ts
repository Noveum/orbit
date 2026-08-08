import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { OrganizationDeletionResult, OrganizationDeletionSummary } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { mockSession } from '../../../../../../tests-support.ts';

const coreModule = await import('@orbit/core');
const summaries: Principal[] = [];
const deletions: { principal: Principal; input: unknown }[] = [];
const published: string[] = [];
let publishError: Error | null = null;

const summary: OrganizationDeletionSummary = {
  organizationName: 'Nova',
  members: 4,
  teams: 3,
  projects: 2,
  issues: 17,
  documents: 5,
  files: 8,
  fileBytes: 4096,
  integrations: 1,
  webhooks: 2,
  availableAt: null,
};

const deletion: OrganizationDeletionResult = {
  deletedOrganizationId: 'org_deleted',
  deletedOrganizationName: 'Nova',
  nextOrganizationId: 'org_next',
};

mock.module('@orbit/core', () => ({
  ...coreModule,
  getOrganizationDeletionSummary: (principal: Principal) => {
    summaries.push(principal);
    return Promise.resolve(summary);
  },
  deleteOrganization: (principal: Principal, input: unknown) => {
    deletions.push({ principal, input });
    return Promise.resolve(deletion);
  },
  publishOrganizationDeleted: (organizationId: string) => {
    published.push(organizationId);
    return publishError === null ? Promise.resolve() : Promise.reject(publishError);
  },
}));

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

let workspace: Workspace;

mockSession(() => ({
  user: {
    id: workspace.admin.userId,
    name: 'Workspace Admin',
    email: 'admin@orbit.test',
  },
  session: { activeOrganizationId: workspace.organizationId },
}));

const { DELETE, GET } = await import(
  '../../../../../../src/app/api/organizations/current/deletion/route.ts'
);

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  summaries.length = 0;
  deletions.length = 0;
  published.length = 0;
  publishError = null;
});

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/organizations/current/deletion', {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
}

describe('GET /api/organizations/current/deletion', () => {
  it('returns the current workspace impact with a no-cache policy', async () => {
    const response = await GET();
    const payload = z.object({ summary: z.unknown() }).parse(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(payload.summary).toEqual(summary);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.organizationId).toBe(workspace.organizationId);
  });
});

describe('DELETE /api/organizations/current/deletion', () => {
  it('deletes the active workspace and publishes its invalidation', async () => {
    const response = await DELETE(request({ confirmation: 'Nova' }));
    const payload = z
      .object({
        deletedOrganizationId: z.string(),
        nextOrganizationId: z.string().nullable(),
      })
      .strict()
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      deletedOrganizationId: deletion.deletedOrganizationId,
      nextOrganizationId: deletion.nextOrganizationId,
    });
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toEqual({
      principal: expect.objectContaining({
        userId: workspace.admin.userId,
        organizationId: workspace.organizationId,
      }),
      input: { confirmation: 'Nova' },
    });
    expect(published).toEqual([deletion.deletedOrganizationId]);
  });

  it('keeps the committed deletion successful when realtime publishing fails', async () => {
    publishError = new Error('redis unavailable');

    const response = await DELETE(request({ confirmation: 'Nova' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedOrganizationId: deletion.deletedOrganizationId,
      nextOrganizationId: deletion.nextOrganizationId,
    });
    expect(published).toEqual([deletion.deletedOrganizationId]);
  });
});
