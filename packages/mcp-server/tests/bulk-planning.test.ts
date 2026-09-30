import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { asc, db, eq, schema } from '@orbit/db';
import {
  addMember,
  connect,
  createWorkspace,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
let admin: TestClient;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
});

afterAll(async () => {
  await admin.close();
});

describe('create_sub_issues', () => {
  it('creates sub issues in order under a parent issue', async () => {
    const parentRes = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Parent feature',
    });
    const parent = parentRes['issue'] as { identifier: string; id: string };

    const result = await admin.result('create_sub_issues', {
      parent: parent.identifier,
      issues: [
        { title: 'Sub task one', priority: 'high' },
        { title: 'Sub task two', priority: 'medium' },
        { title: 'Sub task three', priority: 'low' },
      ],
    });

    expect(result['parent']).toBe(parent.identifier);
    expect(result['count']).toBe(3);
    const identifiers = result['identifiers'] as string[];
    expect(identifiers).toHaveLength(3);

    const rows = await db
      .select({
        id: schema.issue.id,
        identifier: schema.issue.identifier,
        parentId: schema.issue.parentId,
        number: schema.issue.number,
        title: schema.issue.title,
      })
      .from(schema.issue)
      .where(eq(schema.issue.parentId, parent.id))
      .orderBy(asc(schema.issue.number));
    expect(rows).toHaveLength(3);
    expect(identifiers).toEqual(rows.map((r) => r.identifier));
    expect(rows.map((r) => r.title)).toEqual(['Sub task one', 'Sub task two', 'Sub task three']);
  });

  it('fails atomically when the seventh item is invalid and writes nothing', async () => {
    const parentRes = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Parent for rollback',
    });
    const parent = parentRes['issue'] as { identifier: string; id: string };

    const batch: { title: string; state?: string }[] = [];
    for (let index = 1; index <= 10; index += 1) {
      if (index === 7) {
        batch.push({ title: `Item ${index}`, state: 'NonExistentWorkflowState' });
      } else {
        batch.push({ title: `Item ${index}` });
      }
    }

    const failed = await admin.call('create_sub_issues', {
      parent: parent.identifier,
      issues: batch,
    });

    expect(failed.isError).toBe(true);
    const text = (failed.content[0] as { text: string }).text;
    expect(text).toContain('7');

    const created = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.parentId, parent.id));
    expect(created).toHaveLength(0);
  });

  it('refuses more than 50 items in a single call', async () => {
    const parentRes = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Parent for cap check',
    });
    const parent = parentRes['issue'] as { identifier: string };

    const oversized = Array.from({ length: 51 }, (_, i) => ({ title: `Task ${i}` }));
    const failed = await admin.call('create_sub_issues', {
      parent: parent.identifier,
      issues: oversized,
    });

    expect(failed.isError).toBe(true);
  });
});

describe('bulk_update_issues', () => {
  it('updates state and priority across multiple issues in one call', async () => {
    const issue1 = (
      await admin.result('create_issue', { team: workspace.teamKey, title: 'Bulk issue 1' })
    )['issue'] as { identifier: string; id: string };
    const issue2 = (
      await admin.result('create_issue', { team: workspace.teamKey, title: 'Bulk issue 2' })
    )['issue'] as { identifier: string; id: string };

    const result = await admin.result('bulk_update_issues', {
      issues: [issue1.identifier, issue2.identifier],
      patch: { priority: 'urgent', state: 'Done' },
    });

    expect(result['count']).toBe(2);
    expect(result['identifiers']).toEqual([issue1.identifier, issue2.identifier]);

    const updated1 = (await admin.result('get_issue', { issue: issue1.identifier }))['issue'] as {
      priority: string;
      state: string;
    };
    const updated2 = (await admin.result('get_issue', { issue: issue2.identifier }))['issue'] as {
      priority: string;
      state: string;
    };
    expect(updated1.priority).toBe('Urgent');
    expect(updated1.state).toBe('Done');
    expect(updated2.priority).toBe('Urgent');
    expect(updated2.state).toBe('Done');
  });

  it('stops a member from bulk updating issues on a team they cannot read', async () => {
    const member = await addMember(workspace, 'member', 'Mindy Member');
    const memberClient = await connect(await mintToken(workspace.organizationId, member.user.id));
    try {
      const secretTeam = await admin.result('create_team', { name: 'Secret Ops', key: 'SEC' });
      const secretKey = (secretTeam['team'] as { key: string }).key;

      const secretIssue = (
        await admin.result('create_issue', { team: secretKey, title: 'Top secret issue' })
      )['issue'] as { identifier: string };

      const denied = await memberClient.call('bulk_update_issues', {
        issues: [secretIssue.identifier],
        patch: { priority: 'low' },
      });

      expect(denied.isError).toBe(true);
    } finally {
      await memberClient.close();
    }
  });

  it('refuses cross-team bulk update when setting state and reports the item', async () => {
    const otherTeam = await admin.result('create_team', { name: 'Other Team', key: 'OTH' });
    const otherKey = (otherTeam['team'] as { key: string }).key;

    const issue1 = (
      await admin.result('create_issue', { team: workspace.teamKey, title: 'Team 1 issue' })
    )['issue'] as { identifier: string };
    const issue2 = (await admin.result('create_issue', { team: otherKey, title: 'Team 2 issue' }))[
      'issue'
    ] as { identifier: string };

    const failed = await admin.call('bulk_update_issues', {
      issues: [issue1.identifier, issue2.identifier],
      patch: { state: 'Done' },
    });

    expect(failed.isError).toBe(true);
    const text = (failed.content[0] as { text: string }).text;
    expect(text).toContain('Failed on item 2');
    expect(text).toContain(issue2.identifier);

    const read1 = (await admin.result('get_issue', { issue: issue1.identifier }))['issue'] as {
      state: string;
    };
    const read2 = (await admin.result('get_issue', { issue: issue2.identifier }))['issue'] as {
      state: string;
    };
    expect(read1.state).not.toBe('Done');
    expect(read2.state).not.toBe('Done');
  });

  it('refuses cross-team bulk update when setting a team-scoped project and reports the item', async () => {
    const otherTeam = await admin.result('create_team', { name: 'Other Team 2', key: 'OT2' });
    const otherKey = (otherTeam['team'] as { key: string }).key;

    const projectRes = await admin.result('create_project', {
      name: 'Team 1 Project',
      teams: [workspace.teamKey],
    });
    const projectName = (projectRes['project'] as { name: string }).name;

    const issue1 = (
      await admin.result('create_issue', { team: workspace.teamKey, title: 'Team 1 issue' })
    )['issue'] as { identifier: string };
    const issue2 = (await admin.result('create_issue', { team: otherKey, title: 'Team 2 issue' }))[
      'issue'
    ] as { identifier: string };

    const failed = await admin.call('bulk_update_issues', {
      issues: [issue1.identifier, issue2.identifier],
      patch: { project: projectName },
    });

    expect(failed.isError).toBe(true);
    const text = (failed.content[0] as { text: string }).text;
    expect(text).toContain('Failed on item 2');
    expect(text).toContain(issue2.identifier);

    const read1 = (await admin.result('get_issue', { issue: issue1.identifier }))['issue'] as {
      projectId: string | null;
    };
    const read2 = (await admin.result('get_issue', { issue: issue2.identifier }))['issue'] as {
      projectId: string | null;
    };
    expect(read1.projectId).toBeNull();
    expect(read2.projectId).toBeNull();
  });

  it('refuses more than 50 issues in bulk update', async () => {
    const oversized = Array.from({ length: 51 }, (_, i) => `NOVA-${i + 1}`);
    const failed = await admin.call('bulk_update_issues', {
      issues: oversized,
      patch: { priority: 'high' },
    });

    expect(failed.isError).toBe(true);
  });
});
