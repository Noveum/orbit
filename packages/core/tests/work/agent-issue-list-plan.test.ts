import { beforeEach, expect, it } from 'bun:test';
import { db, schema, sql } from '@orbit/db';
import { issueFilterSchema } from '@orbit/shared/validators';
import { newId } from '../../src/internal.ts';
import { addMember, createWorkspace, resetDatabase } from '../../src/test-support.ts';
import { buildIssueWhere } from '../../src/work/issue-query.ts';
import { listIssues } from '../../src/work/issue-service.ts';

beforeEach(resetDatabase);

it('uses the Agent assignee index for the Agent issue queue query', async () => {
  const workspace = await createWorkspace('QueuePlan');
  const owner = await addMember(workspace, 'member');
  const clientId = newId();
  const identityId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Queue plan client',
    redirectUrls: 'https://example.com/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    ownerNameSnapshot: owner.user.name,
    clientId,
    clientNameSnapshot: 'Queue plan client',
    name: 'Queue plan agent',
  });
  const state = workspace.states[0];
  if (state === undefined) throw new Error('The test workspace has no workflow state.');

  await db.execute(sql`
    insert into issue (
      id,
      organization_id,
      team_id,
      number,
      identifier,
      title,
      state_id,
      creator_user_id,
      assignee_agent_id,
      owner_user_id,
      updated_at
    )
    select
      'issue-plan-' || generated.issue_number::text,
      ${workspace.organizationId},
      ${workspace.teamId},
      generated.issue_number,
      'PLAN-' || generated.issue_number::text,
      'Agent queue plan issue ' || generated.issue_number::text,
      ${state.id},
      ${owner.user.id},
      case when generated.issue_number <= 80 then ${identityId} else null end,
      case when generated.issue_number <= 80 then ${owner.user.id} else null end,
      now() - generated.issue_number * interval '1 second'
    from generate_series(1, 20000) as generated(issue_number)
  `);
  await db.execute(sql`analyze issue`);

  const listInput = { assigneeAgentId: identityId, orderBy: 'updated' as const, limit: 25 };
  const page = await listIssues(owner.principal, listInput);
  expect(page.issues).toHaveLength(25);
  expect(page.nextCursor).not.toBeNull();
  expect(page.issues.every((issue) => issue.assigneeAgentId === identityId)).toBe(true);

  const filter = issueFilterSchema.parse(listInput);
  const where = buildIssueWhere(owner.principal, {
    visibility: 'team',
    filter,
    now: new Date(),
  });
  const planRows = await db.execute<{ 'QUERY PLAN': unknown }>(sql`
    explain (analyze, buffers, format json)
    select ${schema.issue.id}
    from ${schema.issue}
    where ${where}
    order by ${schema.issue.updatedAt} desc, ${schema.issue.id} desc
    limit 26
  `);
  const plan = JSON.stringify(planRows[0]?.['QUERY PLAN'] ?? []);
  console.info(`Agent issue queue PostgreSQL plan: ${plan}`);
  expect(plan).toContain('issue_assignee_agent_idx');
  expect(plan).not.toContain('"Node Type":"Seq Scan"');
});
