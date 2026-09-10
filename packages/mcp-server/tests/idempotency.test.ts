import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
let clientGrantA: TestClient;
let clientGrantB: TestClient;

interface IssueShape {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
}

interface CommentShape {
  readonly id: string;
  readonly body: string;
}

function issueOf(payload: Record<string, unknown>): IssueShape {
  return payload['issue'] as IssueShape;
}

function commentOf(payload: Record<string, unknown>): CommentShape {
  return payload['comment'] as CommentShape;
}

function commentsOf(payload: Record<string, unknown>): CommentShape[] {
  return payload['comments'] as CommentShape[];
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('IdempotencyWorkspace');
  const tokenA = await mintToken(workspace.organizationId, workspace.adminUser.id, 'Client A');
  const tokenB = await mintToken(workspace.organizationId, workspace.adminUser.id, 'Client B');
  clientGrantA = await connect(tokenA);
  clientGrantB = await connect(tokenB);
});

afterAll(async () => {
  await clientGrantA.close();
  await clientGrantB.close();
});

describe('MCP write tool idempotency keys', () => {
  it('two create_issue calls with one key create one issue', async () => {
    const key = 'idem-issue-create-001';
    const res1 = await clientGrantA.result('create_issue', {
      team: workspace.teamKey,
      title: 'First issue',
      idempotencyKey: key,
    });
    const issue1 = issueOf(res1);

    const res2 = await clientGrantA.result('create_issue', {
      team: workspace.teamKey,
      title: 'First issue',
      idempotencyKey: key,
    });
    const issue2 = issueOf(res2);

    expect(issue1.id).toBe(issue2.id);
    expect(issue1.identifier).toBe(issue2.identifier);

    const searchRes = await clientGrantA.result('search_issues', { query: 'First issue' });
    const issues = searchRes['issues'] as IssueShape[];
    const matches = issues.filter((item) => item.id === issue1.id);
    expect(matches.length).toBe(1);
  });

  it('a retried add_comment posts once', async () => {
    const issueRes = await clientGrantA.result('create_issue', {
      team: workspace.teamKey,
      title: 'Issue for comment test',
    });
    const issue = issueOf(issueRes);

    const key = 'idem-comment-add-001';
    const commentRes1 = await clientGrantA.result('add_comment', {
      issue: issue.identifier,
      body: 'Idempotent comment body',
      idempotencyKey: key,
    });
    const comment1 = commentOf(commentRes1);

    const commentRes2 = await clientGrantA.result('add_comment', {
      issue: issue.identifier,
      body: 'Idempotent comment body',
      idempotencyKey: key,
    });
    const comment2 = commentOf(commentRes2);

    expect(comment1.id).toBe(comment2.id);

    const threadRes = await clientGrantA.result('list_issue_comments', {
      issue: issue.identifier,
    });
    const comments = commentsOf(threadRes);
    const matches = comments.filter((c) => c.body === 'Idempotent comment body');
    expect(matches.length).toBe(1);
  });

  it('a key reused with different arguments is refused', async () => {
    const key = 'idem-reuse-conflict-001';
    const firstCall = await clientGrantA.result('create_issue', {
      team: workspace.teamKey,
      title: 'Original Title',
      idempotencyKey: key,
    });
    expect(issueOf(firstCall).title).toBe('Original Title');

    const secondCall = await clientGrantA.call('create_issue', {
      team: workspace.teamKey,
      title: 'Different Title',
      idempotencyKey: key,
    });

    expect(secondCall.isError).toBe(true);
    const err = errorPayload(secondCall);
    expect(err.code).toBe('validation_failed');
  });

  it('a key from another grant is a different key', async () => {
    const key = 'shared-key-across-grants';

    const callGrantA = await clientGrantA.result('create_issue', {
      team: workspace.teamKey,
      title: 'Grant A Issue',
      idempotencyKey: key,
    });
    const issueA = issueOf(callGrantA);

    const callGrantB = await clientGrantB.result('create_issue', {
      team: workspace.teamKey,
      title: 'Grant B Issue',
      idempotencyKey: key,
    });
    const issueB = issueOf(callGrantB);

    expect(issueA.id).not.toBe(issueB.id);
    expect(issueA.title).toBe('Grant A Issue');
    expect(issueB.title).toBe('Grant B Issue');
  });

  it('a failed call records terminal failure and replays error on retry', async () => {
    const key = 'idem-failed-call-001';
    const firstCall = await clientGrantA.call('create_issue', {
      team: 'NONEXISTENT_TEAM_KEY',
      title: 'Should fail',
      idempotencyKey: key,
    });
    expect(firstCall.isError).toBe(true);
    const err1 = errorPayload(firstCall);

    const retryCall = await clientGrantA.call('create_issue', {
      team: 'NONEXISTENT_TEAM_KEY',
      title: 'Should fail',
      idempotencyKey: key,
    });
    expect(retryCall.isError).toBe(true);
    const err2 = errorPayload(retryCall);
    expect(err1).toEqual(err2);
  });
});
