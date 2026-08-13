import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { DEFAULT_WORKFLOW_STATES } from '@orbit/core';
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
let agent: TestClient;

const state: Record<string, string> = {};

function idOf(payload: Record<string, unknown>, path: readonly string[]): string {
  let cursor: unknown = payload;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) throw new Error(`missing ${path.join('.')}`);
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== 'string') throw new Error(`${path.join('.')} is not a string`);
  return cursor;
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  agent = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  await addMember(workspace, 'member', 'Bea Builder');

  state['team'] = workspace.teamKey;
  state['project'] = idOf(
    await agent.result('create_project', { name: 'Apollo', teams: [workspace.teamKey] }),
    ['project', 'id'],
  );
  state['doc'] = idOf(await agent.result('create_doc', { title: 'Runbook', content: '# Hi' }), [
    'doc',
    'id',
  ]);
  state['docComment'] = idOf(
    await agent.result('comment_on_doc', { doc: state['doc'], body: 'First note.' }),
    ['comment', 'id'],
  );
  state['milestone'] = idOf(
    await agent.result('create_milestone', { project: state['project'], name: 'Alpha' }),
    ['milestone', 'id'],
  );
  state['view'] = idOf(await agent.result('create_view', { name: 'Mine', filter: {} }), [
    'view',
    'id',
  ]);
  const issue = await agent.result('create_issue', {
    team: workspace.teamKey,
    title: 'Something to archive',
  });
  state['issue'] = idOf(issue, ['issue', 'identifier']);
  await agent.result('archive_issue', { issue: state['issue'] });
});

afterAll(async () => {
  await agent.close();
});

interface SmokeCase {
  readonly tool: string;
  readonly args: () => Record<string, unknown>;
  readonly expect: (payload: Record<string, unknown>) => void;
}

function hasKey(key: string) {
  return (payload: Record<string, unknown>): void => {
    expect(Object.keys(payload)).toContain(key);
    expect(payload['error']).toBeUndefined();
  };
}

function hasRows(key: string) {
  return (payload: Record<string, unknown>): void => {
    expect(Array.isArray(payload[key])).toBe(true);
    expect(payload['error']).toBeUndefined();
  };
}

const SMOKE: readonly SmokeCase[] = [
  { tool: 'list_teams', args: () => ({}), expect: hasRows('teams') },
  { tool: 'list_users', args: () => ({}), expect: hasRows('users') },
  { tool: 'list_labels', args: () => ({}), expect: hasRows('labels') },
  { tool: 'list_states', args: () => ({ team: state['team'] }), expect: hasRows('states') },
  { tool: 'list_projects', args: () => ({}), expect: hasRows('projects') },
  { tool: 'list_doc_collections', args: () => ({}), expect: hasRows('collections') },
  { tool: 'list_doc_comments', args: () => ({ doc: state['doc'] }), expect: hasRows('comments') },
  {
    tool: 'list_milestones',
    args: () => ({ project: state['project'] }),
    expect: hasRows('milestones'),
  },
  {
    tool: 'list_project_milestones',
    args: () => ({ project: state['project'] }),
    expect: hasRows('milestones'),
  },
  {
    tool: 'update_team',
    args: () => ({ team: state['team'], name: 'Renamed team' }),
    expect: hasKey('team'),
  },
  {
    tool: 'update_view',
    args: () => ({ view: state['view'], name: 'Renamed view' }),
    expect: hasKey('view'),
  },
  {
    tool: 'unarchive_issue',
    args: () => ({ issue: state['issue'] }),
    expect: hasKey('restored'),
  },
  {
    tool: 'edit_doc_comment',
    args: () => ({ commentId: state['docComment'], body: 'Second note.' }),
    expect: hasKey('comment'),
  },
  {
    tool: 'create_doc_collection',
    args: () => ({ name: 'Handbook' }),
    expect: hasKey('collection'),
  },
  {
    tool: 'update_milestone',
    args: () => ({ milestoneId: state['milestone'], name: 'Beta' }),
    expect: hasKey('milestone'),
  },
  {
    tool: 'delete_doc_comment',
    args: () => ({ commentId: state['docComment'] }),
    expect: hasKey('deleted'),
  },
  {
    tool: 'delete_milestone',
    args: () => ({ milestoneId: state['milestone'] }),
    expect: hasKey('deleted'),
  },
  {
    tool: 'create_state',
    args: () => ({ team: state['team'], name: 'Blocked', category: 'started' }),
    expect: hasKey('state'),
  },
  {
    tool: 'update_state',
    args: () => ({ team: state['team'], state: 'Blocked', color: '#123456' }),
    expect: hasKey('state'),
  },
  {
    tool: 'reorder_states',
    args: () => ({
      team: state['team'],
      order: ['Blocked', ...DEFAULT_WORKFLOW_STATES.map((entry) => entry.name)],
    }),
    expect: hasRows('states'),
  },
  {
    tool: 'delete_state',
    args: () => ({ team: state['team'], state: 'Blocked' }),
    expect: hasKey('deleted'),
  },
  { tool: 'archive_doc', args: () => ({ doc: state['doc'] }), expect: hasKey('archived') },
  {
    tool: 'archive_project',
    args: () => ({ project: state['project'] }),
    expect: hasKey('archived'),
  },
];

describe('every tool the rest of the suite never calls still answers', () => {
  it('covers a tool the other tests leave alone, and every one is registered', async () => {
    const { tools } = await agent.client.listTools();
    const registered = new Set(tools.map((tool) => tool.name));

    for (const entry of SMOKE) expect(registered.has(entry.tool)).toBe(true);
    expect(SMOKE.length).toBeGreaterThan(15);
  });

  for (const entry of SMOKE) {
    it(`${entry.tool} answers a minimal valid call`, async () => {
      const called = await agent.call(entry.tool, entry.args());

      expect(called.isError ?? false).toBe(false);
      const [first] = called.content;
      if (first === undefined || first.type !== 'text') throw new Error('no text content');
      entry.expect(JSON.parse(first.text) as Record<string, unknown>);
    });
  }
});
