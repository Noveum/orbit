import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildIssueRoutesWorld,
  contextFor,
  errorSchema,
  ISSUES_BASE,
  type IssueRoutesWorld,
  installRouteMocks,
  signInAs,
} from '../../../../../../tests-support-issue-routes.ts';

const duplicateRoute = await import('../../../../../../src/app/api/issues/[id]/duplicate/route.ts');

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
});

describe('POST /api/issues/[id]/duplicate', () => {
  it('marks an issue as duplicate of survivor issue', async () => {
    const response = await duplicateRoute.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ survivorIssueId: world.second.id }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { issue: { id: string } };
    expect(body.issue.id).toBe(world.first.id);
  });

  it('refuses marking an issue as duplicate of itself', async () => {
    const response = await duplicateRoute.POST(
      new Request(`${ISSUES_BASE}/${world.first.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ survivorIssueId: world.first.id }),
      }),
      contextFor(world.first.id),
    );

    expect(response.status).toBe(422);
    const error = errorSchema.parse(await response.json());
    expect(error.error.code).toBe('validation_failed');
  });
});
