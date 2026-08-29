import { beforeEach, describe, expect, it } from 'bun:test';
import { createIssue, createTeam } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { mockSession } from '../../../../../tests-support.ts';

let workspace: Workspace;
let signedIn = false;
let signedInUser: Workspace['adminUser'];

mockSession(() =>
  signedIn
    ? {
        user: signedInUser,
        session: { activeOrganizationId: workspace.organizationId },
      }
    : null,
);

const route = await import('../../../../../src/app/api/analytics/export/route.ts');

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  signedIn = true;
  signedInUser = workspace.adminUser;
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

  it('exports only authorized rows while retaining workspace totals and withheld count', async () => {
    const other = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const otherState = other.states.find((state) => state.category === 'unstarted');
    if (otherState === undefined) throw new Error('Missing Operations state.');
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Visible evidence' });
    await createIssue(workspace.admin, {
      teamId: other.team.id,
      stateId: otherState.id,
      title: 'Hidden evidence',
    });
    const reader = await addMember(workspace, 'guest', { teamIds: [workspace.teamId] });
    signedInUser = reader.user;

    const response = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=current'),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-orbit-export-truncated')).toBe('false');
    expect(csv).toContain('Total workspace issues in cohort,2');
    expect(csv).toContain('Issues withheld due to permissions,1');
    expect(csv).toContain('Visible exported issues,1');
    expect(csv).toContain('Visible evidence');
    expect(csv).not.toContain('Hidden evidence');
  });

  it('marks the export truncated only when visible rows exceed the cap', async () => {
    const state = workspace.states.find((entry) => entry.category === 'unstarted');
    if (state === undefined) throw new Error('Missing workspace state.');
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    for (let offset = 0; offset < 10_000; offset += 1_000) {
      await db.insert(schema.issue).values(
        Array.from({ length: 1_000 }, (_, index) => {
          const number = offset + index + 1;
          return {
            id: randomUUIDv7(createdAt),
            organizationId: workspace.organizationId,
            teamId: workspace.teamId,
            number,
            identifier: `CAP-${number}`,
            title: `Visible cap issue ${number}`,
            stateId: state.id,
            creatorId: workspace.adminUser.id,
            createdAt,
          };
        }),
      );
    }
    const other = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const otherState = other.states.find((entry) => entry.category === 'unstarted');
    if (otherState === undefined) throw new Error('Missing Operations state.');
    await createIssue(workspace.admin, {
      teamId: other.team.id,
      stateId: otherState.id,
      title: 'Withheld cap issue',
    });
    const reader = await addMember(workspace, 'guest', { teamIds: [workspace.teamId] });

    signedInUser = workspace.adminUser;
    const workspaceResponse = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=current'),
    );
    signedInUser = reader.user;
    const restrictedResponse = await route.GET(
      new Request('http://localhost:3000/api/analytics/export?cohort=current'),
    );
    const restrictedCsv = await restrictedResponse.text();

    expect(workspaceResponse.headers.get('x-orbit-export-truncated')).toBe('true');
    expect(restrictedResponse.headers.get('x-orbit-export-truncated')).toBe('false');
    expect(restrictedCsv).toContain('Total workspace issues in cohort,10001');
    expect(restrictedCsv).toContain('Issues withheld due to permissions,1');
    expect(restrictedCsv).toContain('Visible exported issues,10000');
  }, 30_000);
});
