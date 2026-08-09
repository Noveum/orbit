import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { OrganizationDeletionResult, OrganizationDeletionSummary } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { forbidden, internal } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { mockSession } from '../../../../../../tests-support.ts';

const coreModule = await import('@orbit/core');
const summaries: Principal[] = [];
const deletions: { principal: Principal; input: unknown }[] = [];
const published: string[] = [];
let publishError: Error | null = null;
let summaryError: Error | null = null;
let deletionError: Error | null = null;
let signedIn = true;

const summary: OrganizationDeletionSummary = {
  organizationName: 'Nova',
  members: 4,
  teams: 3,
  projects: 2,
  issues: 17,
  documents: 5,
  files: 8,
  fileBytes: 4096,
  fileVersions: 12,
  fileVersionBytes: 6144,
  integrations: 1,
  webhooks: 2,
  availableAt: null,
  deletionRequestedAt: null,
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
    return summaryError === null ? Promise.resolve(summary) : Promise.reject(summaryError);
  },
  deleteOrganization: (principal: Principal, input: unknown) => {
    deletions.push({ principal, input });
    return deletionError === null ? Promise.resolve(deletion) : Promise.reject(deletionError);
  },
  publishOrganizationDeleted: (organizationId: string) => {
    published.push(organizationId);
    return publishError === null ? Promise.resolve() : Promise.reject(publishError);
  },
}));

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

let workspace: Workspace;

mockSession(() =>
  signedIn
    ? {
        user: {
          id: workspace.admin.userId,
          name: 'Workspace Admin',
          email: 'admin@orbit.test',
        },
        session: { activeOrganizationId: workspace.organizationId },
      }
    : null,
);

const { DELETE, GET } = await import(
  '../../../../../../src/app/api/organizations/current/deletion/route.ts'
);
const { apiContext } = await import('../../../../../../src/lib/api/handler.ts');

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
  summaryError = null;
  deletionError = null;
  signedIn = true;
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

  it('requires an authenticated session before calculating the impact', async () => {
    signedIn = false;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(summaries).toEqual([]);
  });

  it('preserves authorization failures from the deletion service', async () => {
    summaryError = forbidden();

    const response = await GET();

    expect(response.status).toBe(403);
  });
});

describe('DELETE /api/organizations/current/deletion', () => {
  it('remains available for a durable deletion retry while normal APIs are locked', async () => {
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));

    await expect(apiContext()).rejects.toMatchObject({ code: 'conflict' });
    const response = await DELETE(request({ confirmation: 'Nova' }));

    expect(response.status).toBe(200);
    expect(deletions).toHaveLength(1);
  });

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

  it('rejects invalid JSON before invoking the deletion service', async () => {
    const response = await DELETE(
      new Request('http://localhost:3000/api/organizations/current/deletion', {
        method: 'DELETE',
        body: '{',
      }),
    );

    expect(response.status).toBe(422);
    expect(deletions).toEqual([]);
    expect(published).toEqual([]);
  });

  it('preserves service authorization failures without publishing', async () => {
    deletionError = forbidden();

    const response = await DELETE(request({ confirmation: 'Nova' }));

    expect(response.status).toBe(403);
    expect(published).toEqual([]);
  });

  it('returns a server failure when storage cleanup cannot complete', async () => {
    deletionError = internal('storage unavailable');

    const response = await DELETE(request({ confirmation: 'Nova' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'storage unavailable' },
    });
    expect(published).toEqual([]);
  });
});
