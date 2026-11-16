import { describe, expect, it } from 'bun:test';
import { humanIssueActor, resolveIssueActor } from '@/lib/query/issue-actors.ts';
import { type Issue, issueSchema } from '@/lib/query/schemas.ts';

function issue(overrides: Partial<Issue> = {}): Issue {
  return issueSchema.parse({
    id: 'issue-1',
    teamId: 'team-1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Title',
    stateId: 'state-1',
    priority: 0,
    creatorId: 'user-1',
    assigneeId: 'user-2',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    syncId: 1,
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    ...overrides,
  });
}

describe('resolveIssueActor', () => {
  it('uses the server identity for a Human missing from workspace members', () => {
    const creator = {
      type: 'user' as const,
      id: 'user-1',
      name: 'Alex',
      avatar: null,
      deleted: false,
    };
    expect(resolveIssueActor(issue({ creator }), 'creator')).toEqual(creator);
  });

  it('keeps Agent type and deleted state even with a null legacy assignee', () => {
    const assignee = {
      type: 'agent' as const,
      id: 'agent-1',
      name: 'Helper',
      avatar: null,
      deleted: true,
    };
    expect(resolveIssueActor(issue({ assigneeId: null, assignee }), 'assignee')).toEqual(assignee);
    expect(
      resolveIssueActor(issue({ assigneeId: null, assigneeAgentId: 'agent-1' }), 'assignee')?.type,
    ).toBe('agent');
  });

  it('resolves a null legacy creator through the canonical Agent reference', () => {
    const row = issue({ creatorId: null, creatorUserId: null, creatorAgentId: 'agent-1' });
    expect(resolveIssueActor(row, 'creator')).toEqual({
      type: 'agent',
      id: 'agent-1',
      name: 'Unknown agent',
      avatar: null,
      deleted: false,
    });
  });

  it('respects explicit null and never infers Owner from the current assignment', () => {
    const row = issue({ assignee: null, ownerUserId: null });
    expect(resolveIssueActor(row, 'assignee')).toBeNull();
    expect(resolveIssueActor(row, 'owner')).toBeNull();
    expect(resolveIssueActor(issue(), 'owner')).toBeNull();
  });

  it('restores legacy user identity without treating absent membership as deletion', () => {
    expect(resolveIssueActor(issue(), 'assignee')).toEqual(humanIssueActor('user-2'));
    expect(resolveIssueActor(issue(), 'creator')?.deleted).toBe(false);
  });
});
