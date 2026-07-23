import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { McpHttpServer } from './server.ts';
import {
  addMember,
  connect,
  createWorkspace,
  errorPayload,
  mintKey,
  resetDatabase,
  startServer,
  type TestClient,
  type TestWorkspace,
} from './test-helpers.ts';

let workspace: TestWorkspace;
let server: McpHttpServer;
let admin: TestClient;
let guest: TestClient;

interface IssueShape {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly state: string | null;
  readonly priority: string;
  readonly assignee: string | null;
  readonly cycleId: string | null;
}

interface DeltaShape {
  readonly model: string;
  readonly action: string;
  readonly id: string;
}

function issueOf(payload: Record<string, unknown>): IssueShape {
  return payload['issue'] as IssueShape;
}

function issuesOf(payload: Record<string, unknown>): IssueShape[] {
  return payload['issues'] as IssueShape[];
}

function deltasOf(payload: Record<string, unknown>): DeltaShape[] {
  return payload['deltas'] as DeltaShape[];
}

async function newIssue(title: string, extra: Record<string, unknown> = {}): Promise<IssueShape> {
  const payload = await admin.result('create_issue', {
    team: workspace.teamKey,
    title,
    ...extra,
  });
  return issueOf(payload);
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  server = await startServer();
  admin = await connect(server, await mintKey(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(server, await mintKey(workspace.organizationId, guestMember.user.id));
});

afterAll(async () => {
  await admin.close();
  await guest.close();
  await server.close();
});

describe('discovery', () => {
  it('advertises every tool with a description', async () => {
    const { tools } = await admin.client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('create_issue');
    expect(names).toContain('search_issues');
    expect(names).toContain('cycle_progress');
    expect(names).toHaveLength(23);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it('reports the caller identity', async () => {
    const payload = await admin.result('get_me');
    expect(payload['role']).toBe('admin');
    const user = payload['user'] as { email: string };
    expect(user.email).toBe(workspace.adminUser.email);
  });
});

describe('permissions', () => {
  it('lets a guest read an issue but not create one', async () => {
    const created = await newIssue('Readable by a guest');

    const denied = await guest.call('create_issue', {
      team: workspace.teamKey,
      title: 'Guests cannot write',
    });
    expect(denied.isError).toBe(true);
    expect(errorPayload(denied).code).toBe('forbidden');

    const read = await guest.result('get_issue', { issue: created.identifier });
    expect(issueOf(read).identifier).toBe(created.identifier);
  });

  it('stops a guest from inviting members', async () => {
    const denied = await guest.call('invite_member', { email: 'nope@orbit.test' });
    expect(denied.isError).toBe(true);
    expect(errorPayload(denied).code).toBe('forbidden');
  });
});

describe('issues', () => {
  it('round trips a created issue by human identifier', async () => {
    const created = await newIssue('Ship the MCP server', {
      description: 'Serve tools over streamable HTTP.',
      priority: 'high',
      assignee: 'me',
    });
    expect(created.identifier).toMatch(new RegExp(`^${workspace.teamKey}-\\d+$`));
    expect(created.priority).toBe('High');
    expect(created.assignee).toBe(workspace.adminUser.name);

    const fetched = await admin.result('get_issue', { issue: created.identifier });
    const issue = issueOf(fetched) as IssueShape & { description: string; labels: string[] };
    expect(issue.id).toBe(created.id);
    expect(issue.description).toBe('Serve tools over streamable HTTP.');
    expect(issue.labels).toEqual([]);
  });

  it('filters a search by text, assignee and state category', async () => {
    const bob = await addMember(workspace, 'member', 'Bo Builder');
    await newIssue('Cache invalidation strategy');
    await newIssue('Rewrite the search index', { assignee: bob.user.name });
    const done = await newIssue('Already finished work');
    await admin.result('move_issue', { issue: done.identifier, state: 'Done' });

    const byText = await admin.result('search_issues', { query: 'search index' });
    expect(issuesOf(byText).map((issue) => issue.title)).toEqual(['Rewrite the search index']);

    const byAssignee = await admin.result('search_issues', { assignee: bob.user.handle });
    expect(issuesOf(byAssignee)).toHaveLength(1);
    expect(issuesOf(byAssignee)[0]?.title).toBe('Rewrite the search index');

    const completed = await admin.result('search_issues', { stateCategory: 'completed' });
    expect(issuesOf(completed).map((issue) => issue.identifier)).toContain(done.identifier);

    const byTeam = await admin.result('search_issues', { team: workspace.teamKey, limit: 200 });
    expect(issuesOf(byTeam).length).toBeGreaterThanOrEqual(3);
  });

  it('lists the issues assigned to the caller', async () => {
    const mine = await newIssue('Mine to finish', { assignee: 'me' });
    const payload = await admin.result('list_my_issues', { limit: 100 });
    expect(issuesOf(payload).map((issue) => issue.identifier)).toContain(mine.identifier);
  });

  it('emits an issue sync action when moving an issue', async () => {
    const created = await newIssue('Move me across the board');
    const payload = await admin.result('move_issue', {
      issue: created.identifier,
      state: 'In Progress',
    });
    expect(issueOf(payload).state).toBe('In Progress');
    const deltas = deltasOf(payload);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ model: 'issue', action: 'update', id: created.id });
  });

  it('comments on an issue', async () => {
    const created = await newIssue('Needs a comment');
    const payload = await admin.result('add_comment', {
      issue: created.identifier,
      body: 'Picking this up now.',
    });
    const comment = payload['comment'] as { id: string; body: string; issue: string };
    expect(comment.body).toBe('Picking this up now.');
    expect(comment.issue).toBe(created.identifier);
    expect(deltasOf(payload)[0]).toMatchObject({ model: 'comment', action: 'insert' });
  });

  it('links two issues in both directions', async () => {
    const first = await newIssue('Blocks the other');
    const second = await newIssue('Blocked by the first');
    await admin.result('set_relation', {
      issue: first.identifier,
      relatedIssue: second.identifier,
      type: 'blocks',
    });

    const fetched = await admin.result('get_issue', { issue: second.identifier });
    const issue = issueOf(fetched) as IssueShape & {
      relations: { type: string; identifier: string }[];
    };
    expect(issue.relations).toContainEqual({ type: 'blocked_by', identifier: first.identifier });
  });

  it('builds a git branch name from an issue', async () => {
    const created = await newIssue('Fix the flaky login redirect');
    const payload = await admin.result('copy_branch_name', { issue: created.identifier });
    expect(payload['branch']).toBe(
      `${workspace.adminUser.handle}/${created.identifier.toLowerCase()}-fix-the-flaky-login-redirect`,
    );
  });

  it('reports a clear error for an unknown identifier', async () => {
    const missing = await admin.call('get_issue', { issue: 'ZZZ-9999' });
    expect(missing.isError).toBe(true);
    expect(errorPayload(missing).code).toBe('not_found');
  });

  it('reports a validation error when the domain rejects an argument', async () => {
    const bad = await admin.call('create_issue', { team: workspace.teamKey, title: '   ' });
    expect(bad.isError).toBe(true);
    expect(errorPayload(bad).code).toBe('validation_failed');
  });

  it('rejects an argument that does not match the tool schema', async () => {
    const bad = await admin.call('create_issue', { team: workspace.teamKey, title: '' });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('title');
  });
});

describe('planning', () => {
  it('creates a project and reports its progress', async () => {
    const created = await admin.result('create_project', {
      name: 'Realtime sync',
      summary: 'Make everything live',
      teams: [workspace.teamKey],
    });
    const project = created['project'] as { id: string; name: string };
    expect(project.name).toBe('Realtime sync');

    await newIssue('Wire the socket', { project: 'Realtime sync' });
    const progress = await admin.result('project_progress', { project: 'realtime-sync' });
    expect(progress['scope']).toBe(1);
    expect(progress['completed']).toBe(0);
  });

  it('moves an issue into the active cycle and back out', async () => {
    const created = await newIssue('Plan into the cycle');
    const active = await admin.result('active_cycle', { team: workspace.teamKey });
    const cycle = active['cycle'] as { id: string };
    expect(cycle).not.toBeNull();

    const moved = await admin.result('move_to_cycle', {
      issue: created.identifier,
      cycle: 'active',
    });
    expect(issueOf(moved).cycleId).toBe(cycle.id);

    const progress = await admin.result('cycle_progress', {
      team: workspace.teamKey,
      cycle: 'active',
    });
    expect(progress['scope']).toBeGreaterThanOrEqual(1);

    const removed = await admin.result('move_to_cycle', {
      issue: created.identifier,
      cycle: null,
    });
    expect(issueOf(removed).cycleId).toBeNull();
  });

  it('lists cycles for a team', async () => {
    const payload = await admin.result('list_cycles', { team: workspace.teamKey });
    expect((payload['cycles'] as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe('admin', () => {
  it('lists members and invites a new one', async () => {
    const members = await admin.result('list_members');
    expect((members['members'] as unknown[]).length).toBeGreaterThanOrEqual(2);

    const invited = await admin.result('invite_member', {
      email: 'newcomer@orbit.test',
      role: 'member',
      teams: [workspace.teamKey],
    });
    const invitation = invited['invitation'] as { email: string; role: string };
    expect(invitation).toMatchObject({ email: 'newcomer@orbit.test', role: 'member' });
  });
});
