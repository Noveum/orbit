import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  addMember,
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
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
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));
});

afterAll(async () => {
  await admin.close();
  await guest.close();
});

describe('discovery', () => {
  it('advertises every tool with a description', async () => {
    const { tools } = await admin.client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('create_issue');
    expect(names).toContain('search_issues');
    expect(names).toContain('cycle_progress');
    expect(names).toContain('open_standup');
    expect(names).toContain('run_standup');
    expect(names).toContain('complete_cycle');
    expect(names).toContain('create_milestone');

    expect(names).toContain('create_doc');
    expect(names).toContain('update_doc');
    expect(names).toContain('get_doc');
    expect(names).toContain('list_docs');
    expect(names).toContain('comment_on_doc');
    expect(names).toContain('archive_issue');
    expect(names).toContain('delete_issue');
    expect(names).toContain('create_label');
    expect(names).toContain('delete_label');
    expect(names).toContain('update_project');
    expect(names).toContain('delete_project');
    expect(names).toContain('delete_sprint');
    expect(names).toContain('edit_comment');
    expect(names).toContain('delete_comment');

    expect(names).toContain('create_team');
    expect(names).toContain('add_team_member');
    expect(names).toContain('remove_team_member');
    expect(names).toContain('remove_member');
    expect(names).toContain('list_views');
    expect(names).toContain('create_view');
    expect(names).toContain('delete_view');

    expect(new Set(names).size).toBe(names.length);
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

  it('resolves a label to update whose reference carries stray whitespace', async () => {
    await admin.result('create_label', { name: 'Trimmed label' });

    const renamed = await admin.result('update_label', {
      label: '  trimmed label  ',
      name: 'Renamed label',
    });

    const label = renamed['label'] as { name: string };
    expect(label.name).toBe('Renamed label');
  });

  it('refuses a reply that belongs to a different issue', async () => {
    const host = await newIssue('Has the thread');
    const other = await newIssue('Somewhere else');
    const parent = (
      await admin.result('add_comment', { issue: other.identifier, body: 'Over here.' })
    )['comment'] as { id: string };

    await expect(
      admin.result('add_comment', {
        issue: host.identifier,
        body: 'Replying across issues.',
        replyTo: parent.id,
      }),
    ).rejects.toThrow();
  });

  it('refuses to nest a reply more than one level deep', async () => {
    const created = await newIssue('Deep thread');
    const parent = (
      await admin.result('add_comment', { issue: created.identifier, body: 'Top level.' })
    )['comment'] as { id: string };
    const reply = (
      await admin.result('add_comment', {
        issue: created.identifier,
        body: 'First reply.',
        replyTo: parent.id,
      })
    )['comment'] as { id: string };

    await expect(
      admin.result('add_comment', {
        issue: created.identifier,
        body: 'Reply to a reply.',
        replyTo: reply.id,
      }),
    ).rejects.toThrow();
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

describe('the scrum ceremony over mcp', () => {
  it('opens a room, walks it, records a turn, and raises a blocker', async () => {
    const opened = await admin.result('open_standup', {
      team: workspace.teamKey,
      heldOn: '2031-03-04',
    });
    const room = opened['standup'] as {
      id: string;
      status: string;
      turns: { id: string; status: string }[];
    };
    expect(room.status).toBe('scheduled');
    expect(room.turns.length).toBeGreaterThan(0);

    const started = await admin.result('run_standup', { standupId: room.id, action: 'start' });
    const running = started['standup'] as { status: string; currentTurnId: string | null };
    expect(running.status).toBe('running');
    expect(running.currentTurnId).not.toBeNull();

    const firstTurn = room.turns[0];
    if (firstTurn === undefined) throw new Error('expected a seated participant');

    const recorded = await admin.result('record_standup_turn', {
      standupId: room.id,
      turnId: firstTurn.id,
      notes: 'Shipped the board fix.',
      attendance: 'present',
    });
    const withNotes = recorded['standup'] as { turns: { id: string; notes: string }[] };
    expect(withNotes.turns.find((turn) => turn.id === firstTurn.id)?.notes).toBe(
      'Shipped the board fix.',
    );

    const raised = await admin.result('raise_blocker', {
      standupId: room.id,
      turnId: firstTurn.id,
      summary: 'Waiting on staging credentials.',
    });
    const blocked = raised['standup'] as { blockers: { id: string; summary: string }[] };
    expect(blocked.blockers).toHaveLength(1);

    const open = await admin.result('list_blockers', { team: workspace.teamKey });
    expect((open['blockers'] as unknown[]).length).toBe(1);

    const blocker = blocked.blockers[0];
    if (blocker === undefined) throw new Error('expected a blocker');
    await admin.result('resolve_blocker', {
      standupId: room.id,
      blockerId: blocker.id,
      resolved: true,
    });
    const cleared = await admin.result('list_blockers', { team: workspace.teamKey });
    expect((cleared['blockers'] as unknown[]).length).toBe(0);
  });

  it('reads back the room it opened, and reports nothing for a day with no standup', async () => {
    await admin.result('open_standup', { team: workspace.teamKey, heldOn: '2031-05-06' });
    const found = await admin.result('get_standup', {
      team: workspace.teamKey,
      heldOn: '2031-05-06',
    });
    expect((found['standup'] as { heldOn: string }).heldOn).toBe('2031-05-06');

    const missing = await admin.result('get_standup', {
      team: workspace.teamKey,
      heldOn: '2031-05-07',
    });
    expect(missing['standup']).toBeNull();
  });

  it('refuses to seat a facilitator who is not on the team', async () => {
    const denied = await admin.call('open_standup', {
      team: workspace.teamKey,
      heldOn: '2031-07-08',
      facilitator: 'nobody@orbit.test',
    });
    expect(denied.isError).toBe(true);
  });
});

describe('sprints over mcp', () => {
  it('creates a sprint and closes it, rolling the unfinished work forward', async () => {
    const created = await admin.result('create_cycle', {
      team: workspace.teamKey,
      name: 'Sprint 99',
      startsAt: '2031-01-05T00:00:00.000Z',
      endsAt: '2031-01-19T00:00:00.000Z',
    });
    const sprint = created['cycle'] as { id: string; name: string; completed: boolean };
    expect(sprint.name).toBe('Sprint 99');
    expect(sprint.completed).toBe(false);

    const renamed = await admin.result('update_cycle', { cycleId: sprint.id, name: 'Sprint 99b' });
    expect((renamed['cycle'] as { name: string }).name).toBe('Sprint 99b');

    const closed = await admin.result('complete_cycle', { cycleId: sprint.id });
    expect((closed['cycle'] as { completed: boolean }).completed).toBe(true);
    expect(closed['nextCycle']).toBeTruthy();
  });

  it('rejects a date it cannot read, naming the field rather than failing deep inside', async () => {
    const denied = await admin.call('create_cycle', {
      team: workspace.teamKey,
      startsAt: 'next Monday',
      endsAt: '2031-02-02',
    });
    expect(denied.isError).toBe(true);
    const [first] = denied.content;
    const text = first !== undefined && first.type === 'text' ? first.text : '';
    expect(text).toContain('startsAt');
    expect(text).toContain('ISO 8601');
  });

  it('takes a plain date as readily as a full timestamp', async () => {
    const created = await admin.result('create_cycle', {
      team: workspace.teamKey,
      name: 'Sprint 100',
      startsAt: '2032-01-05',
      endsAt: '2032-01-19',
    });
    expect((created['cycle'] as { name: string }).name).toBe('Sprint 100');
  });
});

describe('what a token is allowed to do', () => {
  it('hides every write tool from a read only token, and keeps the read ones', async () => {
    const readOnly = await connect(
      await mintToken(workspace.organizationId, workspace.adminUser.id, 'Reader', 'orbit.read'),
    );
    try {
      const { tools } = await readOnly.client.listTools();
      const names = tools.map((tool) => tool.name);

      expect(names).toContain('get_me');
      expect(names).toContain('search_issues');
      expect(names).toContain('get_standup');

      expect(names).not.toContain('create_issue');
      expect(names).not.toContain('update_issue');
      expect(names).not.toContain('open_standup');
      expect(names).not.toContain('complete_cycle');
      expect(names).not.toContain('invite_member');

      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await readOnly.close();
    }
  });

  it('refuses a write call from a read only token rather than performing it', async () => {
    const readOnly = await connect(
      await mintToken(workspace.organizationId, workspace.adminUser.id, 'Reader', 'orbit.read'),
    );
    try {
      const denied = await readOnly.call('create_issue', {
        team: workspace.teamKey,
        title: 'Should never exist',
      });
      expect(denied.isError).toBe(true);

      const search = await admin.result('search_issues', { query: 'Should never exist' });
      expect(issuesOf(search)).toHaveLength(0);
    } finally {
      await readOnly.close();
    }
  });

  it('still gives a token carrying orbit.write the whole set', async () => {
    const { tools } = await admin.client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('create_issue');
  });
});
