import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, ilike, schema } from '@orbit/db';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createProject, postProjectUpdate } from '../../src/work/project-service.ts';
import {
  nudgeStaleProjects,
  PROJECT_STALENESS_NUDGE_INTERVAL_MS,
} from '../../src/work/project-staleness-service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = new Date(604886400000);
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

let workspace: Workspace;

async function newProject(input: Record<string, unknown> = {}): Promise<{ id: string }> {
  const { project } = await createProject(workspace.admin, {
    name: `Project ${Math.random().toString(36).slice(2, 10)}`,
    teamIds: [workspace.teamId],
    ...input,
  });
  return project;
}

async function backdateUpdate(projectId: string, at: Date): Promise<void> {
  await postProjectUpdate(workspace.admin, projectId, { health: 'on_track', body: 'Status' });
  await db
    .update(schema.projectUpdate)
    .set({ createdAt: at })
    .where(eq(schema.projectUpdate.projectId, projectId));
}

async function staleRows(projectId: string) {
  return await db
    .select({ userId: schema.notification.userId, body: schema.notification.body })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.type, 'project_stale'),
        eq(schema.notification.entityId, projectId),
      ),
    );
}

async function staleSourceKeys(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ sourceEventKey: schema.notificationSourceEvent.sourceEventKey })
    .from(schema.notificationSourceEvent)
    .where(
      ilike(schema.notificationSourceEvent.sourceEventKey, `orbit-project-stale:${projectId}:%`),
    );
  return rows.map((row) => row.sourceEventKey);
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

describe('nudgeStaleProjects', () => {
  it('does not nudge a project updated inside the window', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(BASE.getTime() - DAY_MS));

    const outcome = await nudgeStaleProjects(db, { now: BASE });

    expect(outcome.nudged).toBe(0);
    expect((await staleRows(project.id)).length).toBe(0);
  });

  it('nudges a stale project once per weekly interval and resumes after it', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(BASE.getTime() - 15 * DAY_MS));

    const first = await nudgeStaleProjects(db, { now: BASE });
    expect(first.nudged).toBe(1);
    const rows = await staleRows(project.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.userId).toBe(workspace.adminUser.id);

    const repeat = await nudgeStaleProjects(db, { now: new Date(BASE.getTime() + 2 * DAY_MS) });
    expect(repeat.nudged).toBe(0);
    expect((await staleRows(project.id)).length).toBe(1);

    const next = await nudgeStaleProjects(db, { now: new Date(BASE.getTime() + 8 * DAY_MS) });
    expect(next.nudged).toBe(1);
    expect((await staleRows(project.id)).length).toBe(2);
  });

  it('nudges workspace admins when a stale project has no lead', async () => {
    const project = await newProject();

    const outcome = await nudgeStaleProjects(db, { now: BASE });

    expect(outcome.nudged).toBe(1);
    const rows = await staleRows(project.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.userId).toBe(workspace.adminUser.id);
  });

  it('never-updated projects are stale and carry the no-update message', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });

    const outcome = await nudgeStaleProjects(db, { now: BASE });

    expect(outcome.nudged).toBe(1);
    const rows = await staleRows(project.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toBe('No health update has been posted yet.');
  });

  it('skips workspaces that turned the staleness window off', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await db
      .update(schema.organization)
      .set({ projectStalenessDays: 0 })
      .where(eq(schema.organization.id, workspace.organizationId));

    const outcome = await nudgeStaleProjects(db, { now: BASE });

    expect(outcome.nudged).toBe(0);
    expect((await staleRows(project.id)).length).toBe(0);
  });

  it('does not nudge twice when the interval straddles a weekly bucket boundary', async () => {
    const boundary =
      Math.floor(BASE.getTime() / PROJECT_STALENESS_NUDGE_INTERVAL_MS) *
        PROJECT_STALENESS_NUDGE_INTERVAL_MS +
      PROJECT_STALENESS_NUDGE_INTERVAL_MS;
    const firstRunAt = new Date(boundary - TWO_HOURS_MS);
    const secondRunAt = new Date(boundary + TWO_HOURS_MS);

    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(firstRunAt.getTime() - 15 * DAY_MS));

    const first = await nudgeStaleProjects(db, { now: firstRunAt });
    expect(first.nudged).toBe(1);

    const second = await nudgeStaleProjects(db, { now: secondRunAt });
    expect(second.nudged).toBe(0);
    expect((await staleRows(project.id)).length).toBe(1);
  });

  it('keeps a stale project to a single nudge when two runs land in the same tick', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(BASE.getTime() - 15 * DAY_MS));

    const first = await nudgeStaleProjects(db, { now: BASE });
    const second = await nudgeStaleProjects(db, { now: BASE });

    expect(first.nudged + second.nudged).toBe(1);
    expect((await staleRows(project.id)).length).toBe(1);
  });

  it('derives the source key of an owed nudge from the last nudge sent', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(BASE.getTime() - 15 * DAY_MS));

    await nudgeStaleProjects(db, { now: BASE });
    await nudgeStaleProjects(db, { now: new Date(BASE.getTime() + 8 * DAY_MS) });

    const keys = await staleSourceKeys(project.id);
    expect(keys.length).toBe(2);
    expect(keys.some((key) => key.endsWith(':initial'))).toBe(true);
    expect(keys.some((key) => key.endsWith(`:${BASE.getTime()}`))).toBe(true);
  });

  it('publishes the sync actions the notification fanout produced', async () => {
    const project = await newProject({ leadId: workspace.adminUser.id });
    await backdateUpdate(project.id, new Date(BASE.getTime() - 15 * DAY_MS));

    const published: unknown[] = [];
    const outcome = await nudgeStaleProjects(db, {
      now: BASE,
      publish: (actions) => {
        published.push(actions);
        return Promise.resolve();
      },
    });

    expect(outcome.nudged).toBe(1);
    expect(outcome.actions.length).toBeGreaterThan(0);
    expect(published).toEqual([outcome.actions]);
  });
});
