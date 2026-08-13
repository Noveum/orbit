import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import {
  analyticsDrilldownResponseSchema,
  analyticsSprintsResponseSchema,
} from '../../../../src/features/analytics/contracts.ts';
import { mockSession } from '../../../../tests-support.ts';

interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

let workspace: Workspace;
let other: Workspace;
let user: SessionUser | null = null;
let activeOrganizationId = '';

mockSession(() => (user === null ? null : { user, session: { activeOrganizationId } }));

const core = await import('@orbit/core');
const overviewRoute = await import('../../../../src/app/api/analytics/overview/route.ts');
const sprintsRoute = await import('../../../../src/app/api/analytics/sprints/route.ts');
const projectsRoute = await import('../../../../src/app/api/analytics/projects/route.ts');
const peopleRoute = await import('../../../../src/app/api/analytics/people/route.ts');
const drilldownRoute = await import('../../../../src/app/api/analytics/drilldown/route.ts');

function signIn(workspaceValue: Workspace, sessionUser: SessionUser): void {
  workspace = workspaceValue;
  user = sessionUser;
  activeOrganizationId = workspaceValue.organizationId;
}

function request(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  other = await createWorkspace('Orion');
  await core.createCycle(workspace.admin, { name: 'Current' });
  await core.createCycle(other.admin, { name: 'Other current' });
  await core.createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Nova evidence' });
  await core.createIssue(other.admin, { teamId: other.teamId, title: 'Orion evidence' });
  signIn(workspace, workspace.adminUser);
});

describe('analytics lens routes', () => {
  it('allows every workspace role to read workspace analytics', async () => {
    const callers = [workspace.adminUser];
    for (const role of ['member', 'contributor', 'guest'] as const) {
      callers.push((await addMember(workspace, role)).user);
    }

    for (const caller of callers) {
      signIn(workspace, caller);
      const response = await overviewRoute.GET(request('/api/analytics/overview'));
      expect(response.status).toBe(200);
      expect((await response.json()).lens).toBe('overview');
    }
  });

  it('requires an authenticated workspace membership', async () => {
    user = null;

    const response = await overviewRoute.GET(request('/api/analytics/overview'));

    expect(response.status).toBe(401);
  });

  it('parses every lens through the same strict query boundary', async () => {
    const invalid = '?range=custom&from=2026-08-12&to=2026-08-01';
    const responses = await Promise.all([
      overviewRoute.GET(request(`/api/analytics/overview${invalid}`)),
      sprintsRoute.GET(request(`/api/analytics/sprints${invalid}`)),
      projectsRoute.GET(request(`/api/analytics/projects${invalid}`)),
      peopleRoute.GET(request(`/api/analytics/people${invalid}`)),
    ]);

    expect(responses.map((response) => response.status)).toEqual([422, 422, 422, 422]);
  });

  it('reports malformed nested filter JSON as validation instead of an internal error', async () => {
    const response = await overviewRoute.GET(request('/api/analytics/overview?filter=%7Bnot-json'));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('validation_failed');
  });

  it('returns one JSON-safe contract for each lens', async () => {
    const [overview, sprints, projects, people] = await Promise.all([
      overviewRoute.GET(request('/api/analytics/overview')),
      sprintsRoute.GET(request('/api/analytics/sprints')),
      projectsRoute.GET(request('/api/analytics/projects')),
      peopleRoute.GET(request('/api/analytics/people')),
    ]);

    expect(await overview.json()).toMatchObject({ lens: 'overview' });
    expect(await sprints.json()).toMatchObject({ lens: 'sprints' });
    expect(await projects.json()).toMatchObject({ lens: 'projects' });
    expect(await people.json()).toMatchObject({ lens: 'people' });
  });

  it('returns a schema-valid empty sprint lens without a current or completed sprint', async () => {
    await resetDatabase();
    workspace = await createWorkspace('Empty');
    await db.delete(schema.cycle);
    signIn(workspace, workspace.adminUser);

    const response = await sprintsRoute.GET(request('/api/analytics/sprints'));
    const payload = analyticsSprintsResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.selected).toBeNull();
    expect(payload.current).toBeNull();
  });

  it('returns a schema-valid empty sprint lens when every sprint is upcoming', async () => {
    await resetDatabase();
    workspace = await createWorkspace('Upcoming');
    await db.delete(schema.cycle);
    signIn(workspace, workspace.adminUser);
    await core.createCycle(
      workspace.admin,
      {
        name: 'Future',
        startsAt: new Date('2099-01-01T00:00:00.000Z'),
        endsAt: new Date('2099-01-08T00:00:00.000Z'),
      },
      new Date('2098-01-01T00:00:00.000Z'),
    );

    const response = await sprintsRoute.GET(request('/api/analytics/sprints'));
    const payload = analyticsSprintsResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.selected).toBeNull();
    expect(payload.current).toBeNull();
  });

  it('resolves people My Work to the current principal without adding focus to the clean URL', async () => {
    const member = await addMember(workspace, 'member', { name: 'Mina Member' });
    signIn(workspace, member.user);

    const response = await peopleRoute.GET(request('/api/analytics/people'));
    const payload = await response.json();

    expect(payload.focused.person.id).toBe(member.user.id);
    expect(analyticsQuerySchema.parse({ lens: 'people' }).focus).toEqual({});
  });
});

describe('analytics drilldown route', () => {
  it('keeps issue evidence inside the active workspace', async () => {
    const response = await drilldownRoute.GET(
      request('/api/analytics/drilldown?cohort=current&limit=50'),
    );
    const payload = analyticsDrilldownResponseSchema.parse(await response.json());

    expect(payload.total).toBe(1);
    expect(payload.issues.map((issue) => issue.title)).toEqual(['Nova evidence']);
  });

  it('binds a signed cursor to the workspace that created it', async () => {
    await core.createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Second evidence' });
    const first = await drilldownRoute.GET(
      request('/api/analytics/drilldown?cohort=current&limit=1'),
    );
    const page = analyticsDrilldownResponseSchema.parse(await first.json());
    if (page.nextCursor === null) throw new Error('the first page should have a next cursor');
    signIn(other, other.adminUser);

    const response = await drilldownRoute.GET(
      request(`/api/analytics/drilldown?cohort=current&limit=1&cursor=${page.nextCursor}`),
    );

    expect(response.status).toBe(422);
  });

  it('signs cursors and rejects a modified page token', async () => {
    await core.createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Second evidence' });
    const first = await drilldownRoute.GET(
      request('/api/analytics/drilldown?cohort=current&limit=1'),
    );
    const page = analyticsDrilldownResponseSchema.parse(await first.json());
    if (page.nextCursor === null) throw new Error('the first page should have a next cursor');

    const valid = await drilldownRoute.GET(
      request(`/api/analytics/drilldown?cohort=current&limit=1&cursor=${page.nextCursor}`),
    );
    const tampered = await drilldownRoute.GET(
      request(`/api/analytics/drilldown?cohort=current&limit=1&cursor=${page.nextCursor}x`),
    );

    expect(valid.status).toBe(200);
    expect(tampered.status).toBe(422);
  });
});
