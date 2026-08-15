import { beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { mockSession } from '../../../../../tests-support.ts';

let workspace: Workspace;
let signedIn = false;

mockSession(() =>
  signedIn
    ? {
        user: workspace.adminUser,
        session: { activeOrganizationId: workspace.organizationId },
      }
    : null,
);

const route = await import('../../../../../src/app/api/analytics/insights/route.ts');

function request(query?: unknown): Request {
  const url = new URL('http://localhost:3000/api/analytics/insights');
  if (query !== undefined) url.searchParams.set('query', JSON.stringify(query));
  return new Request(url.toString());
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Nova evidence' });
  signedIn = true;
});

describe('GET /api/analytics/insights', () => {
  it('returns a bars or scatter result for an authenticated valid query', async () => {
    const response = await route.GET(request({ insight: { measure: 'count', slice: 'state' } }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(['bars', 'scatter']).toContain(payload.kind);
  });

  it('rejects a malformed insight measure as a validation error', async () => {
    const response = await route.GET(request({ insight: { measure: 'not-a-real-measure' } }));

    expect(response.status).toBe(422);
  });

  it('requires an authenticated session', async () => {
    signedIn = false;

    const response = await route.GET(request());

    expect(response.status).toBe(401);
  });
});
