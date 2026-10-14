import { describe, expect, it } from 'bun:test';
import { issueActorSchema, issueSchema } from '../../src/validators/issue-response.ts';

const actorsSchema = issueSchema.pick({
  creator: true,
  assignee: true,
  owner: true,
  creatorUserId: true,
  creatorAgentId: true,
  assigneeUserId: true,
  assigneeAgentId: true,
  ownerUserId: true,
});

describe('Issue Actor response contract', () => {
  it('preserves Human and deleted Agent names, avatars and types', () => {
    const creator = {
      type: 'user' as const,
      id: 'user-1',
      name: 'Alex',
      avatar: 'https://example.com/alex.png',
      deleted: false,
    };
    const assignee = {
      type: 'agent' as const,
      id: 'agent-1',
      name: 'Build helper',
      avatar: 'https://example.com/helper.png',
      deleted: true,
    };
    expect(actorsSchema.parse({ creator, assignee, owner: null })).toEqual({
      creator,
      assignee,
      owner: null,
    });
  });

  it('distinguishes legacy omissions from explicit null identities', () => {
    expect(actorsSchema.parse({})).toEqual({});
    expect(actorsSchema.parse({ assignee: null, owner: null, ownerUserId: null })).toEqual({
      assignee: null,
      owner: null,
      ownerUserId: null,
    });
  });

  it('rejects incomplete actors rather than inventing lifecycle or avatar values', () => {
    expect(
      issueActorSchema.safeParse({ type: 'agent', id: 'agent-1', name: 'Helper' }).success,
    ).toBe(false);
  });
});
