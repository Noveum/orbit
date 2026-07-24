import { db, schema } from '@orbit/db';
import { newId } from '../internal.ts';
import { stateNamed, type Workspace } from '../test-support.ts';

export interface IssueFixture {
  readonly number: number;
  readonly title?: string;
  readonly state: string;
  readonly cycleId?: string | null;
  readonly projectId?: string | null;
  readonly assigneeId?: string | null;
  readonly estimate?: number | null;
  readonly priority?: number;
  readonly createdAt?: Date;
  readonly startedAt?: Date | null;
  readonly completedAt?: Date | null;
}

export async function insertIssue(workspace: Workspace, fixture: IssueFixture): Promise<string> {
  const id = newId();
  await db.insert(schema.issue).values({
    id,
    organizationId: workspace.organizationId,
    teamId: workspace.teamId,
    number: fixture.number,
    identifier: `NOV-${fixture.number}`,
    title: fixture.title ?? `Issue ${fixture.number}`,
    stateId: stateNamed(workspace, fixture.state).id,
    priority: fixture.priority ?? 0,
    creatorId: workspace.adminUser.id,
    assigneeId: fixture.assigneeId ?? null,
    projectId: fixture.projectId ?? null,
    cycleId: fixture.cycleId ?? null,
    estimate: fixture.estimate ?? null,
    startedAt: fixture.startedAt ?? null,
    completedAt: fixture.completedAt ?? null,
    createdAt: fixture.createdAt ?? new Date(),
  });
  return id;
}

export function insertLabelOn(issueId: string, labelId: string): Promise<unknown> {
  return db.insert(schema.issueLabel).values({ id: newId(), issueId, labelId });
}

export async function createLabel(workspace: Workspace, name: string): Promise<string> {
  const id = newId();
  await db.insert(schema.label).values({
    id,
    organizationId: workspace.organizationId,
    teamId: workspace.teamId,
    name,
    color: '#5A63C8',
  });
  return id;
}

export async function createProjectRow(workspace: Workspace, name: string): Promise<string> {
  const id = newId();
  await db.insert(schema.project).values({
    id,
    organizationId: workspace.organizationId,
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 6)}`,
  });
  return id;
}

export function utc(iso: string): Date {
  return new Date(iso);
}
