import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { createUser, resetDatabase } from '../test-support.ts';
import { createOrganization } from './organization-service.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('workspace seeding on create', () => {
  it('leaves a seeded workspace non-empty with a doc, a project, and issues', async () => {
    const user = await createUser('Seed Owner');
    const bootstrap = await createOrganization(
      user.id,
      { name: 'Seedco', slug: `seedco-${crypto.randomUUID().slice(0, 8)}` },
      { seed: true },
    );

    const issues = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.teamId, bootstrap.team.id));
    expect(issues.length).toBeGreaterThan(0);

    const docs = await db
      .select()
      .from(schema.doc)
      .where(eq(schema.doc.organizationId, bootstrap.organization.id));
    expect(docs).toHaveLength(1);

    const projects = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.organizationId, bootstrap.organization.id));
    expect(projects).toHaveLength(1);

    const [team] = await db
      .select({ issueCounter: schema.team.issueCounter })
      .from(schema.team)
      .where(eq(schema.team.id, bootstrap.team.id));
    expect(team?.issueCounter).toBe(issues.length);

    const models = new Set(bootstrap.actions.map((action) => action.model));
    expect(models.has('issue')).toBe(true);
    expect(models.has('doc')).toBe(true);
    expect(models.has('project')).toBe(true);
  });

  it('leaves the workspace empty when seeding is not requested', async () => {
    const user = await createUser('Bare Owner');
    const bootstrap = await createOrganization(user.id, {
      name: 'Bareco',
      slug: `bareco-${crypto.randomUUID().slice(0, 8)}`,
    });

    const issues = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.teamId, bootstrap.team.id));
    expect(issues).toHaveLength(0);
    expect(bootstrap.actions.map((action) => action.model).sort()).toEqual(['member', 'team']);
  });
});
