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

const route = await import('../../../../../src/app/api/analytics/export/route.ts');

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  signedIn = true;
});

describe('GET /api/analytics/export', () => {
  it('exports exact semantic evidence with formulas and spreadsheet defense', async () => {
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: '=HYPERLINK("https://bad.invalid")',
      estimate: 3,
    });

    const response = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=current&measure=points'),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('orbit-analytics-evidence.csv');
    expect(response.headers.get('x-orbit-export-truncated')).toBe('false');
    expect(csv).toContain('Predicate,current');
    expect(csv).toContain('Measure,points');
    expect(csv).toContain('Formula,Sum of estimates; unestimated counts as 1');
    expect(csv).toContain('Timezone,');
    expect(csv).toContain('Coverage,Exact semantic issue cohort');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain(',3,');
  });

  it('requires a session and rejects malformed cohort input', async () => {
    signedIn = false;
    const unauthorized = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=current'),
    );
    signedIn = true;
    const invalid = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=priority:not-a-number'),
    );

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(422);
  });
});
