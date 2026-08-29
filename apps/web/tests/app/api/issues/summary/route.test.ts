import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  buildIssueRoutesWorld,
  type IssueRoutesWorld,
  installRouteMocks,
  signInAs,
} from '../../../../../tests-support-issue-routes.ts';

const summaryRoute = await import('../../../../../src/app/api/issues/summary/route.ts');

const summarySchema = z.object({
  total: z.number(),
  groupTotals: z.record(z.string(), z.number()),
});

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
});

describe('GET /api/issues/summary', () => {
  it('accepts the reviewer-aware participant grouping used by standup', async () => {
    const response = await summaryRoute.GET(
      new Request('http://localhost:3000/api/issues/summary?groupBy=participant'),
    );
    const summary = summarySchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(summary.groupTotals[world.admin.userId]).toBeGreaterThanOrEqual(2);
  });
});
