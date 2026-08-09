import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  SESSION_REVOKED_CLOSE_CODE,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';
import type { SessionGate, WorkspaceRecoveryGate } from '../../../src/lib/realtime/provider.tsx';
import {
  endSessionIfRevoked,
  handleTerminalClose,
  recoverWorkspaceAfterForbidden,
} from '../../../src/lib/realtime/provider.tsx';

const HERE = 'https://orbit.example/my-issues';

const location = { href: HERE };
const savedWindow = Reflect.getOwnPropertyDescriptor(globalThis, 'window');

interface Recorder {
  readonly gate: SessionGate;
  readonly calls: { sessions: unknown[]; signOuts: number };
}

function gateReturning(answer: () => Promise<unknown>): Recorder {
  const calls = { sessions: [] as unknown[], signOuts: 0 };
  return {
    calls,
    gate: {
      getSession: (options) => {
        calls.sessions.push(options);
        return answer();
      },
      signOut: () => {
        calls.signOuts += 1;
        return Promise.resolve(undefined);
      },
    },
  };
}

interface WorkspaceRecorder {
  readonly gate: WorkspaceRecoveryGate;
  readonly calls: { lists: number; active: string[] };
}

function workspaceGateReturning(organizations: unknown): WorkspaceRecorder {
  const calls = { lists: 0, active: [] as string[] };
  return {
    calls,
    gate: {
      listOrganizations: () => {
        calls.lists += 1;
        return Promise.resolve({ organizations });
      },
      setActive: ({ organizationId }) => {
        calls.active.push(organizationId);
        return Promise.resolve({ error: null });
      },
    },
  };
}

beforeEach(() => {
  location.href = HERE;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location },
  });
});

afterEach(() => {
  if (savedWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', savedWindow);
});

describe('endSessionIfRevoked', () => {
  it('signs out and leaves for the login page when the server has no session left', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: null }));

    expect(await endSessionIfRevoked(gate)).toBe(true);
    expect(calls.signOuts).toBe(1);
    expect(location.href).toBe('/login');
  });

  it('bypasses the cookie cache so a stale cached session cannot mask a revocation', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: null }));

    await endSessionIfRevoked(gate);

    expect(calls.sessions).toEqual([{ query: { disableCookieCache: true } }]);
  });

  it('keeps the user signed in when the server still has the session', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: { session: { id: 'live' } } }));

    expect(await endSessionIfRevoked(gate)).toBe(false);
    expect(calls.signOuts).toBe(0);
    expect(location.href).toBe(HERE);
  });

  it('keeps the user signed in when the session check throws', async () => {
    const { gate, calls } = gateReturning(() => Promise.reject(new Error('offline')));

    expect(await endSessionIfRevoked(gate)).toBe(false);
    expect(calls.signOuts).toBe(0);
    expect(location.href).toBe(HERE);
  });

  it('keeps the user signed in when the session check answers with an error', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: null, error: { status: 500 } }));

    expect(await endSessionIfRevoked(gate)).toBe(false);
    expect(calls.signOuts).toBe(0);
    expect(location.href).toBe(HERE);
  });
});

describe('handleTerminalClose', () => {
  it('does not touch the session when the socket merely fails to authenticate', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: null }));

    handleTerminalClose(UNAUTHORIZED_CLOSE_CODE, gate);
    await Promise.resolve();

    expect(calls.sessions).toEqual([]);
    expect(calls.signOuts).toBe(0);
    expect(location.href).toBe(HERE);
  });

  it('ignores an ordinary transport close', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: null }));

    handleTerminalClose(1006, gate);
    await Promise.resolve();

    expect(calls.sessions).toEqual([]);
    expect(location.href).toBe(HERE);
  });

  it('checks with the server when the hub reports the session was revoked', async () => {
    const { gate, calls } = gateReturning(async () => ({ data: { session: { id: 'live' } } }));

    handleTerminalClose(SESSION_REVOKED_CLOSE_CODE, gate);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.sessions).toHaveLength(1);
    expect(calls.signOuts).toBe(0);
    expect(location.href).toBe(HERE);
  });

  it('starts workspace recovery only for an organization-forbidden close', async () => {
    const session = gateReturning(async () => ({ data: { session: { id: 'live' } } }));
    const workspace = workspaceGateReturning([{ id: 'org_2' }]);

    handleTerminalClose(ORGANIZATION_FORBIDDEN_CLOSE_CODE, session.gate, workspace.gate);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(workspace.calls.lists).toBe(1);
    expect(workspace.calls.active).toEqual(['org_2']);
    expect(location.href).toBe('/my-issues');
    expect(session.calls.sessions).toEqual([]);
  });
});

describe('recoverWorkspaceAfterForbidden', () => {
  it('activates the first surviving workspace before leaving the stale tenant', async () => {
    const { gate, calls } = workspaceGateReturning([{ id: 'org_2' }, { id: 'org_3' }]);

    await recoverWorkspaceAfterForbidden(gate);

    expect(calls.active).toEqual(['org_2']);
    expect(location.href).toBe('/my-issues');
  });

  it('opens workspace creation when no membership remains', async () => {
    const { gate, calls } = workspaceGateReturning([]);

    await recoverWorkspaceAfterForbidden(gate);

    expect(calls.active).toEqual([]);
    expect(location.href).toBe('/workspaces/new');
  });

  it('fails closed to workspace creation when recovery throws', async () => {
    const { gate } = workspaceGateReturning([{ id: 'org_2' }]);
    const failing: WorkspaceRecoveryGate = {
      ...gate,
      setActive: () => Promise.reject(new Error('session update failed')),
    };

    await recoverWorkspaceAfterForbidden(failing);

    expect(location.href).toBe('/workspaces/new');
  });

  it('fails closed when the surviving workspace cannot be activated', async () => {
    const { gate } = workspaceGateReturning([{ id: 'org_2' }]);
    const rejected: WorkspaceRecoveryGate = {
      ...gate,
      setActive: () => Promise.resolve({ error: { message: 'membership changed' } }),
    };

    await recoverWorkspaceAfterForbidden(rejected);

    expect(location.href).toBe('/workspaces/new');
  });
});
