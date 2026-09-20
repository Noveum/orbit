const AGENT_FEATURE_GATES = [
  'agent_identity_read',
  'agent_consent',
  'agent_issue_write',
  'issue_outbox_dispatch',
] as const;

export type AgentFeatureGate = (typeof AGENT_FEATURE_GATES)[number];

export function agentFeatureEnabled(gate: AgentFeatureGate): boolean {
  return process.env[`ORBIT_${gate.toUpperCase()}`] === 'true';
}
