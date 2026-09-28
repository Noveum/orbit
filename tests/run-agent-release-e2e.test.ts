import { describe, expect, test } from 'bun:test';
import {
  type AgentReleasePhase,
  createAgentReleaseEnvironment,
  runAgentReleasePhases,
} from '../scripts/run-agent-release-e2e.ts';

describe('Agent HTTP release E2E scheduling', () => {
  test('starts Writer-off only after Writer-on succeeds and cleans up', async () => {
    const calls: string[] = [];
    const exitCode = await runAgentReleasePhases(
      (phase) => {
        calls.push(phase);
        return 0;
      },
      () => {
        calls.push('cleanup');
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual(['writer-on', 'writer-off', 'cleanup']);
  });

  test('does not start Writer-off after Writer-on fails and still cleans up', async () => {
    const calls: string[] = [];
    const exitCode = await runAgentReleasePhases(
      (phase) => {
        calls.push(phase);
        return 1;
      },
      () => {
        calls.push('cleanup');
      },
    );

    expect(exitCode).toBe(1);
    expect(calls).toEqual(['writer-on', 'cleanup']);
  });

  test('uses one token handoff path and the required gate values for each phase', () => {
    const inherited = { ORBIT_TEST_LANE: 'release-lane' };
    const tokenFile = 'C:/private/token.json';
    const writerOn = createAgentReleaseEnvironment(
      inherited,
      'writer-on',
      tokenFile,
      'C:/private/results/on',
    );
    const writerOff = createAgentReleaseEnvironment(
      inherited,
      'writer-off',
      tokenFile,
      'C:/private/results/off',
    );
    const gates = (environment: Record<string, string>): string[] => [
      environment['ORBIT_AGENT_IDENTITY_READ'] ?? '',
      environment['ORBIT_AGENT_CONSENT'] ?? '',
      environment['ORBIT_AGENT_ISSUE_WRITE'] ?? '',
      environment['ORBIT_ISSUE_OUTBOX_DISPATCH'] ?? '',
    ];
    const phaseValues: Record<AgentReleasePhase, string[]> = {
      'writer-on': ['true', 'true', 'true', 'true'],
      'writer-off': ['true', 'true', 'false', 'true'],
    };

    expect(writerOn['ORBIT_MCP_VALIDATION_TOKEN_FILE']).toBe(tokenFile);
    expect(writerOff['ORBIT_MCP_VALIDATION_TOKEN_FILE']).toBe(tokenFile);
    expect(gates(writerOn)).toEqual(phaseValues['writer-on']);
    expect(gates(writerOff)).toEqual(phaseValues['writer-off']);
    expect(writerOn['ORBIT_E2E_SKIP_SEED']).toBe('false');
    expect(writerOff['ORBIT_E2E_SKIP_SEED']).toBe('true');
  });
});
