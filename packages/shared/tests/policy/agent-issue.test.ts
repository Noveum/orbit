import { describe, expect, it } from 'bun:test';
import { assertAgentIssueWrite, type Principal } from '../../src/policy/index.ts';

const principal: Principal = {
  userId: 'owner',
  organizationId: 'workspace',
  role: 'member',
  teamIds: [],
};

describe('Agent Issue write policy', () => {
  it('requires both the explicit grant scope and the current Human permission', () => {
    expect(() => assertAgentIssueWrite(principal, 'orbit.read', 'issue:create')).toThrow();
    expect(() =>
      assertAgentIssueWrite(
        { ...principal, role: 'guest' },
        'orbit.read orbit.write',
        'issue:create',
      ),
    ).toThrow();
    expect(() =>
      assertAgentIssueWrite(principal, 'orbit.read orbit.write', 'issue:create'),
    ).not.toThrow();
  });
});
