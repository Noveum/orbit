import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { duplicateIssueListSchema } from '@/lib/query/schemas.ts';
import {
  buildIssueRoutesWorld,
  type IssueRoutesWorld,
  installRouteMocks,
  signInAs,
} from '../../../../../tests-support-issue-routes.ts';

const duplicatesRoute = await import('../../../../../src/app/api/issues/duplicates/route.ts');

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
});

describe('GET /api/issues/duplicates', () => {
  it('returns duplicate suggestions matching title query within the specified team', async () => {
    const url = `http://localhost:3000/api/issues/duplicates?teamId=${world.workspace.teamId}&title=${encodeURIComponent('Blocks the other issue')}`;
    const response = await duplicatesRoute.GET(new Request(url));
    const result = duplicateIssueListSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.duplicates.length).toBeGreaterThanOrEqual(1);
    expect(result.duplicates.map((d) => d.id)).toContain(world.first.id);
    expect(result.duplicates[0]?.identifier).toBe(world.first.identifier);
  });

  it('returns empty array when title has less than 3 characters', async () => {
    const url = `http://localhost:3000/api/issues/duplicates?teamId=${world.workspace.teamId}&title=ab`;
    const response = await duplicatesRoute.GET(new Request(url));
    const result = duplicateIssueListSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.duplicates).toEqual([]);
  });
});
