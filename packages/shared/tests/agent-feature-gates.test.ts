import { afterEach, expect, it } from 'bun:test';
import { agentFeatureEnabled, agentIssueWritesEnabled } from '../src/index.ts';

const GATES = [
  'ORBIT_AGENT_IDENTITY_READ',
  'ORBIT_AGENT_CONSENT',
  'ORBIT_AGENT_ISSUE_WRITE',
  'ORBIT_ISSUE_OUTBOX_DISPATCH',
] as const;
const originalGates = new Map(GATES.map((gate) => [gate, process.env[gate]]));

afterEach(() => {
  for (const gate of GATES) {
    const original = originalGates.get(gate);
    if (original === undefined) delete process.env[gate];
    else process.env[gate] = original;
  }
});

it('keeps each Agent feature gate closed unless its exact value is true', () => {
  for (const gate of GATES) delete process.env[gate];
  expect(agentFeatureEnabled('agent_issue_write')).toBe(false);
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = '1';
  expect(agentFeatureEnabled('agent_issue_write')).toBe(false);
});

it('requires every rollout dependency before allowing Agent issue writes', () => {
  for (const gate of GATES) process.env[gate] = 'true';
  expect(agentIssueWritesEnabled()).toBe(true);
  for (const gate of GATES) {
    process.env[gate] = 'false';
    expect(agentIssueWritesEnabled()).toBe(false);
    process.env[gate] = 'true';
  }
});
