import { describe, expect, it } from 'bun:test';
import {
  assertMcpGrantOwner,
  assertMcpToolAccess,
  canUseMcpTool,
  type McpIdentity,
  type Principal,
} from '../../src/policy/index.ts';

const owner: Principal = {
  userId: 'owner',
  organizationId: 'workspace',
  role: 'guest',
  teamIds: [],
};
const agent: McpIdentity = { kind: 'agent', id: 'identity', name: 'Build assistant' };

describe('MCP connection ownership', () => {
  it('allows an owner to revoke their connection without an administrator role', () => {
    expect(() =>
      assertMcpGrantOwner(owner, { userId: owner.userId, organizationId: owner.organizationId }),
    ).not.toThrow();
  });

  it('rejects another owner, another workspace and a missing owner', () => {
    const administrator: Principal = { ...owner, role: 'admin' };
    for (const grant of [
      { userId: 'another-owner', organizationId: owner.organizationId },
      { userId: owner.userId, organizationId: 'another-workspace' },
      { userId: null, organizationId: owner.organizationId },
    ]) {
      expect(() => assertMcpGrantOwner(administrator, grant)).toThrow('Only the owner');
    }
  });
});

describe('MCP tool access', () => {
  it('preserves legacy read and write scope decisions', () => {
    const identity: McpIdentity = { kind: 'legacy' };
    expect(canUseMcpTool({ reads: true, writes: false, identity }, { readOnly: true })).toBe(true);
    expect(canUseMcpTool({ reads: true, writes: false, identity }, { readOnly: false })).toBe(
      false,
    );
    expect(canUseMcpTool({ reads: false, writes: true, identity }, { readOnly: false })).toBe(true);
    expect(canUseMcpTool({ reads: false, writes: true, identity }, { readOnly: true })).toBe(false);
    expect(
      canUseMcpTool({ reads: true, writes: false, identity }, { readOnly: true, agentSafe: false }),
    ).toBe(true);
  });

  it('requires an agent read scope and rejects writes even with a write scope', () => {
    expect(canUseMcpTool({ reads: true, writes: true, identity: agent }, { readOnly: true })).toBe(
      true,
    );
    expect(canUseMcpTool({ reads: false, writes: true, identity: agent }, { readOnly: true })).toBe(
      false,
    );
    for (const operation of [{ readOnly: false }, { readOnly: true, agentSafe: false }]) {
      expect(() =>
        assertMcpToolAccess({ reads: true, writes: true, identity: agent }, operation),
      ).toThrow('write side effects');
    }
  });
});
