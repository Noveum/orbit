import { describe, expect, it } from 'bun:test';
import {
  actorRefSchema,
  agentIdentityProfileSchema,
  agentIdentitySelectionSchema,
  idempotencyKeySchema,
} from '../../src/validators/agent-identity.ts';

describe('agent identity validators', () => {
  it('accepts only strict Orbit-hosted identity profiles', () => {
    expect(
      agentIdentityProfileSchema.parse({ name: '  Researcher  ', avatar: '/api/avatars/agent-1' }),
    ).toEqual({ name: 'Researcher', avatar: '/api/avatars/agent-1' });
    expect(
      agentIdentityProfileSchema.safeParse({
        name: 'Researcher',
        avatar: 'https://tracker.example/a',
      }).success,
    ).toBe(false);
    expect(
      agentIdentityProfileSchema.safeParse({
        name: 'Researcher',
        avatar: null,
        scope: 'orbit.read',
      }).success,
    ).toBe(false);
  });

  it('makes selecting and creating an identity mutually exclusive', () => {
    expect(
      agentIdentitySelectionSchema.safeParse({
        agentIdentityId: 'agent-1',
        replaceActiveGrant: false,
        createAgent: { name: 'Researcher', avatar: null },
      }).success,
    ).toBe(false);
    expect(
      agentIdentitySelectionSchema.parse({ createAgent: { name: 'Researcher', avatar: null } }),
    ).toEqual({ createAgent: { name: 'Researcher', avatar: null } });
  });

  it('keeps actor refs typed and idempotency keys bounded', () => {
    expect(actorRefSchema.parse({ type: 'agent', id: 'agent-1' })).toEqual({
      type: 'agent',
      id: 'agent-1',
    });
    expect(
      actorRefSchema.safeParse({ type: 'agent', id: 'agent-1', name: 'Researcher' }).success,
    ).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
