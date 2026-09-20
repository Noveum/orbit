import { afterEach, describe, expect, it } from 'bun:test';
import { type AgentFeatureGate, agentFeatureEnabled } from '../src/agent-feature-gates.ts';

const gates: readonly AgentFeatureGate[] = [
  'agent_identity_read',
  'agent_consent',
  'agent_issue_write',
  'issue_outbox_dispatch',
];
const initial = new Map(
  gates.map((gate) => [`ORBIT_${gate.toUpperCase()}`, process.env[`ORBIT_${gate.toUpperCase()}`]]),
);

afterEach(() => {
  for (const [key, value] of initial) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('agent feature gates', () => {
  it('keeps every agent capability disabled unless explicitly enabled', () => {
    for (const gate of gates) {
      delete process.env[`ORBIT_${gate.toUpperCase()}`];
      expect(agentFeatureEnabled(gate)).toBe(false);
    }
    process.env['ORBIT_AGENT_CONSENT'] = 'false';
    expect(agentFeatureEnabled('agent_consent')).toBe(false);
    process.env['ORBIT_AGENT_CONSENT'] = 'true';
    expect(agentFeatureEnabled('agent_consent')).toBe(true);
  });
});
