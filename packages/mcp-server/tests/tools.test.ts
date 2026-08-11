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
  readonly parentId: string | null;
  readonly dueDate: string | null;
  readonly milestoneId: string | null;
}

interface RelationShape {
  readonly type: string;
  readonly identifier: string;
  readonly title: string;
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

function relationsOf(payload: Record<string, unknown>): RelationShape[] {
  const issue = payload['issue'] as { relations?: RelationShape[] };
  return issue.relations ?? [];
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
    expect(names).toContain('complete_cycle');
    expect(names).toContain('start_cycle');
    expect(names).toContain('create_milestone');
    expect(names).toContain('reorder_milestones');

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

    expect(
      relationsOf(await admin.result('get_issue', { issue: second.identifier })),
    ).toContainEqual({
      type: 'blocked_by',
      identifier: first.identifier,
      title: 'Blocks the other',
    });
  });

  it('unlinks two issues from either end', async () => {
    const first = await newIssue('Still blocks the other');
    const second = await newIssue('Still blocked by the first');
    await admin.result('set_relation', {
      issue: first.identifier,
      relatedIssue: second.identifier,
      type: 'blocks',
    });

    const removed = await admin.result('remove_relation', {
      issue: second.identifier,
      relatedIssue: first.identifier,
      type: 'blocked_by',
    });

    expect(removed['relations']).toEqual([]);
    expect(relationsOf(await admin.result('get_issue', { issue: first.identifier }))).toEqual([]);
  });

  it('unlinks from the end that wrote the relation, not only the inverse end', async () => {
    const first = await newIssue('Blocks, removed from its own end');
    const second = await newIssue('Blocked, left alone');
    await admin.result('set_relation', {
      issue: first.identifier,
      relatedIssue: second.identifier,
      type: 'blocks',
    });

    const removed = await admin.result('remove_relation', {
      issue: first.identifier,
      relatedIssue: second.identifier,
      type: 'blocks',
    });

    expect(removed['relations']).toEqual([]);
    expect(relationsOf(await admin.result('get_issue', { issue: second.identifier }))).toEqual([]);
  });

  it('refuses to unlink a relation that was never written', async () => {
    const first = await newIssue('Unrelated one');
    const second = await newIssue('Unrelated two');

    const failure = await admin.call('remove_relation', {
      issue: first.identifier,
      relatedIssue: second.identifier,
      type: 'blocks',
    });

    expect(failure.isError).toBe(true);
    expect(errorPayload(failure).code).toBe('not_found');
  });

  it('makes an issue a sub issue and detaches it again', async () => {
    const parent = await newIssue('Epic parent');
    const child = await newIssue('Loose task');

    const attached = await admin.result('update_issue', {
      issue: child.identifier,
      parent: parent.identifier,
    });
    expect(issueOf(attached).parentId).toBe(parent.id);

    const detached = await admin.result('update_issue', {
      issue: child.identifier,
      parent: null,
    });
    expect(issueOf(detached).parentId).toBeNull();
  });

  it('writes a due date and clears it', async () => {
    const created = await newIssue('Ships on a date');

    const dated = await admin.result('update_issue', {
      issue: created.identifier,
      dueDate: '2031-03-04',
    });
    expect(issueOf(dated).dueDate).toBe('2031-03-04');

    const cleared = await admin.result('update_issue', {
      issue: created.identifier,
      dueDate: null,
    });
    expect(issueOf(cleared).dueDate).toBeNull();
  });

  it('refuses a guest every write to the new fields, whatever the tool offers', async () => {
    const parent = await newIssue('Guarded parent');
    const child = await newIssue('Guarded child');
    await admin.result('set_relation', {
      issue: parent.identifier,
      relatedIssue: child.identifier,
      type: 'blocks',
    });

    const refusals = await Promise.all([
      guest.call('update_issue', { issue: child.identifier, dueDate: '2031-03-04' }),
      guest.call('update_issue', { issue: child.identifier, parent: parent.identifier }),
      guest.call('remove_relation', {
        issue: parent.identifier,
        relatedIssue: child.identifier,
        type: 'blocks',
      }),
      guest.call('attach_file', {
        parentType: 'issue',
        parentId: child.id,
        fileName: 'notes.txt',
        contentType: 'text/plain',
        content: 'aGVsbG8=',
      }),
    ]);

    expect(refusals.map((refusal) => refusal.isError)).toEqual([true, true, true, true]);
    expect(refusals.map((refusal) => errorPayload(refusal).code)).toEqual([
      'forbidden',
      'forbidden',
      'forbidden',
      'forbidden',
    ]);
    expect(relationsOf(await admin.result('get_issue', { issue: parent.identifier }))).toHaveLength(
      1,
    );
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
    const active = await admin.result('active_cycle', {});
    const cycle = active['cycle'] as { id: string };
    expect(cycle).not.toBeNull();

    const moved = await admin.result('move_to_cycle', {
      issue: created.identifier,
      cycle: 'active',
    });
    expect(issueOf(moved).cycleId).toBe(cycle.id);

    const removed = await admin.result('move_to_cycle', {
      issue: created.identifier,
      cycle: null,
    });
    expect(issueOf(removed).cycleId).toBeNull();
  });

  it('reports the scope, the points and the burn up of a sprint that is three days old', async () => {
    const created = await admin.result('create_team', { name: 'Burn Up', key: 'BURN' });
    const teamKey = (created['team'] as { key: string }).key;
    const opened = await admin.result('active_cycle', {});
    const sprint = opened['cycle'] as { id: string; startsAt: string };
    await admin.result('update_cycle', {
      cycleId: sprint.id,
      startsAt: new Date(Date.parse(sprint.startsAt) - 3 * 86_400_000).toISOString(),
    });

    const baseline = await admin.result('cycle_progress', { cycle: 'active' });
    const baseChanges = baseline['changes'] as { added: number; removed: number };

    const heavy = await newIssue('Rebuild the fan out', { team: teamKey, estimate: 5 });
    const light = await newIssue('Rename the banner', { team: teamKey, estimate: 3 });
    for (const issue of [heavy, light]) {
      await admin.result('move_to_cycle', { issue: issue.identifier, cycle: 'active' });
    }
    await admin.result('update_issue', { issue: light.identifier, state: 'Todo' });
    await admin.result('update_issue', { issue: heavy.identifier, state: 'Done' });

    const progress = await admin.result('cycle_progress', { cycle: 'active' });
    expect(progress['scope']).toBe(2);
    expect(progress['completed']).toBe(1);
    expect(progress['points']).toEqual({ scope: 8, started: 0, completed: 5 });
    expect(progress['changes']).toMatchObject({
      added: baseChanges.added + 2,
      addedPoints: 8,
      removed: baseChanges.removed,
      removedPoints: 0,
    });
    const burnUp = progress['burnUp'] as { scope: number; scopePoints: number }[];
    expect(burnUp.map((point) => point.scope)).toEqual([0, 0, 0, 2]);
    expect(burnUp.map((point) => point.scopePoints)).toEqual([0, 0, 0, 8]);
    expect(burnUp.at(-1)).toMatchObject({ completed: 1, completedPoints: 5 });

    await admin.result('move_to_cycle', { issue: light.identifier, cycle: null });
    const afterPull = await admin.result('cycle_progress', { cycle: 'active' });
    expect(afterPull['scope']).toBe(1);
    expect(afterPull['points']).toMatchObject({ scope: 5 });
    expect(afterPull['changes']).toMatchObject({
      added: baseChanges.added + 2,
      addedPoints: 8,
      removed: baseChanges.removed + 1,
      removedPoints: 3,
    });
    expect((afterPull['burnUp'] as { scope: number }[]).map((point) => point.scope)).toEqual([
      0, 0, 0, 1,
    ]);
  });

  it('lists the sprints of the workspace', async () => {
    const payload = await admin.result('list_cycles', {});
    expect((payload['cycles'] as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

interface MilestoneShape {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
}

function milestonesOf(payload: Record<string, unknown>): MilestoneShape[] {
  return payload['milestones'] as MilestoneShape[];
}

describe('milestones over mcp', () => {
  async function projectWithMilestones(
    name: string,
    milestoneNames: readonly string[],
  ): Promise<string> {
    await admin.result('create_project', { name, teams: [workspace.teamKey] });
    for (const milestoneName of milestoneNames) {
      await admin.result('create_milestone', { project: name, name: milestoneName });
    }
    return name;
  }

  it('reorders the milestones of a project by name', async () => {
    const project = await projectWithMilestones('Reordered launch', ['One', 'Two', 'Three']);

    const reordered = await admin.result('reorder_milestones', {
      project,
      milestones: ['Three', 'One', 'Two'],
    });

    expect(milestonesOf(reordered).map((row) => row.name)).toEqual(['Three', 'One', 'Two']);
    const listed = await admin.result('list_milestones', { project });
    expect(milestonesOf(listed).map((row) => row.name)).toEqual(['Three', 'One', 'Two']);
  });

  it('refuses an order that leaves one of the milestones out', async () => {
    const project = await projectWithMilestones('Partial order', ['Alpha', 'Beta']);

    const failed = await admin.call('reorder_milestones', { project, milestones: ['Alpha'] });

    expect(failed.isError).toBe(true);
    expect(errorPayload(failed).code).toBe('conflict');
    const listed = await admin.result('list_milestones', { project });
    expect(milestonesOf(listed).map((row) => row.name)).toEqual(['Alpha', 'Beta']);
  });

  it('refuses a guest, whose role cannot manage milestones', async () => {
    const project = await projectWithMilestones('Guarded order', ['First', 'Second']);

    const created = await guest.call('create_milestone', { project, name: 'Guest milestone' });
    const reordered = await guest.call('reorder_milestones', {
      project,
      milestones: ['Second', 'First'],
    });

    expect(created.isError).toBe(true);
    expect(errorPayload(created).code).toBe('forbidden');
    expect(reordered.isError).toBe(true);
    expect(errorPayload(reordered).code).toBe('forbidden');
    const listed = await admin.result('list_milestones', { project });
    expect(milestonesOf(listed).map((row) => row.name)).toEqual(['First', 'Second']);
  });

  it('puts an issue on a milestone of its own project and takes it back off', async () => {
    const project = await projectWithMilestones('Milestone bearing', ['Cut over']);
    const issue = await newIssue('Do the cut over', { project });
    const listed = milestonesOf(await admin.result('list_milestones', { project }));
    const target = listed[0];
    if (target === undefined) throw new Error('missing seeded milestone');

    const attached = await admin.result('update_issue', {
      issue: issue.identifier,
      project,
      milestone: 'Cut over',
    });
    expect(attached['changed']).toContain('milestoneId');
    expect(issueOf(attached).milestoneId).toBe(target.id);

    const detached = await admin.result('update_issue', {
      issue: issue.identifier,
      milestone: null,
    });
    expect(issueOf(detached).milestoneId).toBeNull();
  });

  it('refuses a milestone that belongs to another project', async () => {
    const here = await projectWithMilestones('Milestone here', ['Ours']);
    await projectWithMilestones('Milestone elsewhere', ['Theirs']);
    const issue = await newIssue('Cross project attempt', { project: here });

    const failed = await admin.call('update_issue', {
      issue: issue.identifier,
      milestone: 'Theirs',
    });

    expect(failed.isError).toBe(true);
    expect(errorPayload(failed).code).toBe('not_found');
  });

  it('refuses a name that two milestones on the project share, rather than guessing', async () => {
    const project = await projectWithMilestones('Twice named', ['Cut over', 'Cut over']);
    const listed = milestonesOf(await admin.result('list_milestones', { project }));
    const [first, second] = listed;
    if (first === undefined || second === undefined) throw new Error('missing seeded milestones');
    const issue = await newIssue('Ambiguous target', { project });

    const failed = await admin.call('update_issue', {
      issue: issue.identifier,
      milestone: 'Cut over',
    });

    expect(failed.isError).toBe(true);
    expect(errorPayload(failed).code).toBe('conflict');

    const resolved = await admin.result('update_issue', {
      issue: issue.identifier,
      milestone: second.id,
    });
    expect(issueOf(resolved).milestoneId).toBe(second.id);
  });

  it('refuses a milestone on an issue that is on no project', async () => {
    await projectWithMilestones('Unreachable milestone', ['Orphaned']);
    const issue = await newIssue('No project at all');

    const failed = await admin.call('update_issue', {
      issue: issue.identifier,
      milestone: 'Orphaned',
    });

    expect(failed.isError).toBe(true);
    expect(errorPayload(failed).code).toBe('validation_failed');
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

  it('closes a sprint two weeks out when no end date is given', async () => {
    const created = await admin.result('create_cycle', {
      team: workspace.teamKey,
      name: 'Sprint 101',
      startsAt: '2033-01-05',
    });
    const sprint = created['cycle'] as { startsAt: string; endsAt: string };
    expect(Date.parse(sprint.endsAt) - Date.parse(sprint.startsAt)).toBe(14 * 86_400_000);
  });

  it('appends a sprint after the last one when it is given no dates', async () => {
    const team = await admin.result('create_team', { name: 'Appender', key: 'APND' });
    const teamKey = (team['team'] as { key: string }).key;
    const before = await admin.result('list_cycles', {});
    const last = (before['cycles'] as { endsAt: string }[]).at(-1);
    if (last === undefined) throw new Error('the new team has no sprint');

    const created = await admin.result('create_cycle', { team: teamKey });
    const sprint = created['cycle'] as { startsAt: string; endsAt: string };

    expect(sprint.startsAt).toBe(last.endsAt);
    expect(Date.parse(sprint.endsAt) - Date.parse(sprint.startsAt)).toBe(14 * 86_400_000);
  });

  it('starts the sprint that follows the one it just closed, and refuses to start it twice', async () => {
    const opened = await admin.result('active_cycle', {});
    const running = opened['cycle'] as { id: string };

    const closed = await admin.result('complete_cycle', { cycleId: running.id });
    const successor = closed['nextCycle'] as { id: string };

    const between = await admin.result('active_cycle', {});
    expect(between['cycle']).toBeNull();

    const started = await admin.result('start_cycle', { cycleId: successor.id });
    const startsAt = Date.parse((started['cycle'] as { startsAt: string }).startsAt);
    expect(Math.abs(startsAt - Date.now())).toBeLessThan(60_000);

    const after = await admin.result('active_cycle', {});
    expect((after['cycle'] as { id: string }).id).toBe(successor.id);

    const again = await admin.call('start_cycle', { cycleId: successor.id });
    expect(again.isError).toBe(true);
    expect(errorPayload(again).code).toBe('conflict');
  });

  it('refuses to start a sprint for somebody whose role cannot manage sprints', async () => {
    const created = await admin.result('create_cycle', {
      team: workspace.teamKey,
      name: 'Sprint 102',
      startsAt: '2034-01-05',
    });
    const sprint = created['cycle'] as { id: string; startsAt: string };

    const denied = await guest.call('start_cycle', { cycleId: sprint.id });
    expect(denied.isError).toBe(true);
    expect(errorPayload(denied).code).toBe('forbidden');

    const untouched = await admin.result('list_cycles', {});
    const rows = untouched['cycles'] as { id: string; startsAt: string }[];
    expect(rows.find((row) => row.id === sprint.id)?.startsAt).toBe(sprint.startsAt);
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
      expect(names).toContain('list_cycles');

      expect(names).not.toContain('create_issue');
      expect(names).not.toContain('update_issue');
      expect(names).not.toContain('create_cycle');
      expect(names).not.toContain('complete_cycle');
      expect(names).not.toContain('start_cycle');
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
