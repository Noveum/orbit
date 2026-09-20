import { describe, expect, it } from 'bun:test';
import { issueActorView } from '../../src/work/issue-actor-view.ts';

describe('issue actor compatibility view', () => {
  it('prefers canonical Human columns while preserving legacy Human ids for existing clients', () => {
    const view = issueActorView({
      creatorId: 'legacy-creator',
      creatorUserId: 'canonical-creator',
      creatorAgentId: null,
      assigneeId: 'legacy-assignee',
      assigneeUserId: 'canonical-assignee',
      assigneeAgentId: null,
      ownerUserId: 'canonical-owner',
    });

    expect(view).toEqual({
      creator: { type: 'user', id: 'canonical-creator' },
      assignee: { type: 'user', id: 'canonical-assignee' },
      owner: { type: 'user', id: 'canonical-owner' },
      creatorId: 'legacy-creator',
      assigneeId: 'legacy-assignee',
      assigneeAgentId: null,
    });
  });

  it('falls back to legacy Human columns for rows still awaiting the migration', () => {
    const view = issueActorView({
      creatorId: 'legacy-creator',
      creatorUserId: null,
      creatorAgentId: null,
      assigneeId: null,
      assigneeUserId: null,
      assigneeAgentId: null,
      ownerUserId: null,
    });

    expect(view.creator).toEqual({ type: 'user', id: 'legacy-creator' });
    expect(view.assignee).toBeNull();
    expect(view.owner).toBeNull();
  });

  it('represents canonical Agent references without interpreting them as Humans', () => {
    const view = issueActorView({
      creatorId: 'legacy-creator',
      creatorUserId: null,
      creatorAgentId: 'agent-creator',
      assigneeId: null,
      assigneeUserId: null,
      assigneeAgentId: 'agent-assignee',
      ownerUserId: 'human-owner',
    });

    expect(view.creator).toEqual({ type: 'agent', id: 'agent-creator' });
    expect(view.assignee).toEqual({ type: 'agent', id: 'agent-assignee' });
    expect(view.owner).toEqual({ type: 'user', id: 'human-owner' });
  });
});
