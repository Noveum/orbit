import { describe, expect, it } from 'bun:test';
import { agentConsentSelectionSchema } from '../../src/validators/agent-identity.ts';

describe('Agent write consent selection', () => {
  it('keeps existing named and selected identities read-only by default', () => {
    expect(agentConsentSelectionSchema.parse({ name: ' Reader ' })).toEqual({
      name: 'Reader',
      write: false,
    });
    expect(agentConsentSelectionSchema.parse({ identityId: 'selected' })).toEqual({
      identityId: 'selected',
      write: false,
    });
    expect(agentConsentSelectionSchema.parse({ identityId: 'selected', write: true })).toEqual({
      identityId: 'selected',
      write: true,
    });
  });

  it('rejects coerced permission and injected identity bindings', () => {
    for (const selection of [
      { name: 'Writer', write: 'true' },
      { identityId: 'selected', write: 1 },
      { name: 'Writer', write: true, grantId: 'forged' },
      { identityId: 'selected', write: true, ownerMemberId: 'forged' },
    ])
      expect(agentConsentSelectionSchema.safeParse(selection).success).toBe(false);
  });
});
