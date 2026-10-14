import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  catchUp,
  createIssue,
  createOrganization,
  deleteCycle,
  getIssue,
  listIssues,
  removeMember,
  updateIssue,
  updateLabel,
  updateWorkflowState,
} from '@orbit/core';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema, sql } from '@orbit/db';
import { issueSchema } from '@orbit/shared/validators';
import { attachIssueDecorations } from '../../../src/lib/api/issues.ts';
import { dehydratedWorkspace } from '../../../src/lib/query/prefetch.ts';
import { issueListSchema } from '../../../src/lib/query/schemas.ts';

let workspace: Workspace;
let installedTrigger = false;

beforeAll(async () => {
  const [existing] = await db.execute(
    sql`select 1 from pg_trigger where tgname = 'issue_human_actor_compat_trigger'`,
  );
  if (existing !== undefined) return;
  const migration = await readFile(
    new URL(
      '../../../../../packages/db/drizzle/0033_issue_actor_write_compatibility.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const statements = migration
    .split('--> statement-breakpoint')
    .filter((statement) =>
      /^CREATE(?: OR REPLACE)? (FUNCTION sync_issue_human_actors|TRIGGER issue_human_actor_compat_trigger)/.test(
        statement.trim(),
      ),
    );
  expect(statements).toHaveLength(2);
  for (const statement of statements) await db.execute(sql.raw(statement));
  installedTrigger = true;
});

afterAll(async () => {
  if (!installedTrigger) return;
  await db.execute(sql`drop trigger issue_human_actor_compat_trigger on issue`);
  await db.execute(sql`drop function sync_issue_human_actors()`);
});

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Actorresponses');
});

async function agentIssue() {
  const created = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Agent work',
    assigneeId: null,
  });
  const id = crypto.randomUUID();
  await db.insert(schema.agentIdentity).values({
    id,
    organizationId: workspace.organizationId,
    ownerUserId: workspace.adminUser.id,
    name: 'Build helper',
    avatar: 'https://example.test/helper.png',
    ownerNameSnapshot: workspace.adminUser.name,
    clientNameSnapshot: 'Fixture',
  });
  await db
    .update(schema.issue)
    .set({
      creatorId: null,
      creatorUserId: null,
      creatorAgentId: id,
      assigneeUserId: null,
      assigneeAgentId: id,
    })
    .where(eq(schema.issue.id, created.issue.id));
  await db
    .update(schema.issue)
    .set({ ownerUserId: null })
    .where(eq(schema.issue.id, created.issue.id));
  return await getIssue(workspace.admin, created.issue.id);
}

function actorsOf(value: unknown) {
  const issue = issueSchema.parse(JSON.parse(JSON.stringify(value)));
  return { creator: issue.creator, assignee: issue.assignee, owner: issue.owner };
}

describe('Issue Actor decorations', () => {
  it('includes complete Human Actors in new workspace starter events', async () => {
    const user = await createUser('Starter owner');
    const created = await createOrganization(
      user.id,
      { name: 'Starter', slug: `starter-${user.id}` },
      { seed: true },
    );
    const issues = created.actions.filter((action) => action.model === 'issue');
    expect(issues.length).toBeGreaterThan(0);
    for (const action of issues) {
      const actors = actorsOf(action.data);
      expect(actors.creator).toEqual({
        type: 'user',
        id: user.id,
        name: user.name,
        avatar: null,
        deleted: false,
      });
      expect(actors.assignee?.type ?? null).toBe(
        action.data['assigneeId'] === null ? null : 'user',
      );
      expect(action.data['ownerUserId']).toEqual(actors.owner?.id ?? null);
    }
  });

  it('retains organization context for projected lists and matches mutation, live and catchup', async () => {
    const row = await agentIssue();
    const expected = actorsOf(row);
    expect(expected.assignee).toMatchObject({
      type: 'agent',
      name: 'Build helper',
      deleted: false,
    });
    expect(expected.owner).toBeNull();
    expect(row.creatorId).toBeNull();
    const hydrated = await dehydratedWorkspace(workspace.admin);
    const initial = hydrated.queries.find((query) => query.queryKey[0] === 'issues')?.state.data as
      | { pages: unknown[] }
      | undefined;
    const seeded = issueListSchema
      .parse(initial?.pages[0])
      .issues.find((issue) => issue.id === row.id);
    expect(seeded?.creatorId).toBeNull();
    expect(seeded?.creator).toEqual(expected.creator);
    const page = await listIssues(workspace.admin, { teamId: workspace.teamId });
    const listed = page.issues.find((issue) => issue.id === row.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('organizationId');
    expect(
      actorsOf(
        (await attachIssueDecorations(page.issues, workspace.organizationId)).find(
          (issue) => issue.id === row.id,
        ),
      ),
    ).toEqual(expected);
    const changed = await updateIssue(workspace.admin, row.id, { title: 'Updated by a Human' });
    expect(actorsOf(changed.issue)).toEqual(expected);
    expect(actorsOf(changed.actions.find((action) => action.model === 'issue')?.data)).toEqual(
      expected,
    );
    const caught = await catchUp(workspace.admin, changed.issue.syncId - 1);
    expect(
      actorsOf(
        caught.actions.find((action) => action.model === 'issue' && action.modelId === row.id)
          ?.data,
      ),
    ).toEqual(expected);
  });

  it('does not expose a foreign Agent name or avatar through a projected response', async () => {
    const row = await agentIssue();
    const foreign = await createWorkspace('Foreignactors');
    const id = crypto.randomUUID();
    await db.insert(schema.agentIdentity).values({
      id,
      organizationId: foreign.organizationId,
      name: 'Private name',
      avatar: 'https://example.test/private.png',
      ownerNameSnapshot: 'Private owner',
      clientNameSnapshot: 'Fixture',
    });
    await db.update(schema.issue).set({ assigneeAgentId: id }).where(eq(schema.issue.id, row.id));
    const page = await listIssues(workspace.admin, { teamId: workspace.teamId });
    const actor = (await attachIssueDecorations(page.issues, workspace.organizationId)).find(
      (issue) => issue.id === row.id,
    )?.assignee;
    expect(actor).toEqual({
      type: 'agent',
      id,
      name: 'Deleted agent',
      avatar: null,
      deleted: true,
    });
  });

  it('keeps a removed member Human identity and only replaces the current assignee', async () => {
    const member = await addMember(workspace, 'member', { name: 'Former member' });
    const created = await createIssue(member.principal, {
      teamId: workspace.teamId,
      title: 'Member work',
      assigneeId: member.user.id,
    });
    await db
      .update(schema.issue)
      .set({
        creatorUserId: member.user.id,
        assigneeUserId: member.user.id,
        ownerUserId: member.user.id,
      })
      .where(eq(schema.issue.id, created.issue.id));
    const [membership] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, member.user.id),
        ),
      );
    if (membership === undefined) throw new Error('Missing fixture membership');
    const removed = await removeMember(workspace.admin, membership.id, {
      reassignToUserId: workspace.adminUser.id,
    });
    const action = removed.actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === created.issue.id,
    );
    expect(action?.data['creator']).toMatchObject({
      type: 'user',
      id: member.user.id,
      name: 'Former member',
      deleted: false,
    });
    expect(action?.data['owner']).toMatchObject({
      type: 'user',
      id: member.user.id,
      deleted: false,
    });
    expect(action?.data['assignee']).toMatchObject({
      type: 'user',
      id: workspace.adminUser.id,
      deleted: false,
    });
    expect(actorsOf(action?.data)).toEqual(
      actorsOf(await getIssue(workspace.admin, created.issue.id)),
    );
  });

  it('includes Actors in cycle, label and workflow Issue events', async () => {
    const row = await agentIssue();
    const expected = actorsOf(row);
    const [cycle] = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, workspace.organizationId))
      .limit(1);
    if (cycle === undefined) throw new Error('Missing fixture cycle');
    await db.update(schema.issue).set({ cycleId: cycle.id }).where(eq(schema.issue.id, row.id));
    const cycleActions = await deleteCycle(workspace.admin, cycle.id);
    expect(actorsOf(cycleActions.find((action) => action.modelId === row.id)?.data)).toEqual(
      expected,
    );
    const secondTeamId = crypto.randomUUID();
    await db.insert(schema.team).values({
      id: secondTeamId,
      organizationId: workspace.organizationId,
      name: 'Other',
      key: 'OTH',
    });
    const labelId = crypto.randomUUID();
    await db.insert(schema.label).values({
      id: labelId,
      organizationId: workspace.organizationId,
      name: 'Fixture label',
      color: '#112233',
    });
    await db
      .insert(schema.issueLabel)
      .values({ id: crypto.randomUUID(), issueId: row.id, labelId });
    const labelChange = await updateLabel(workspace.admin, labelId, { teamId: secondTeamId });
    expect(actorsOf(labelChange.actions.find((action) => action.modelId === row.id)?.data)).toEqual(
      expected,
    );
    const stateChange = await updateWorkflowState(workspace.admin, row.stateId, {
      category: 'started',
    });
    expect(actorsOf(stateChange.actions.find((action) => action.modelId === row.id)?.data)).toEqual(
      expected,
    );
  });
});
