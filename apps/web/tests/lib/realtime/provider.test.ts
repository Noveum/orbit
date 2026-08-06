import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SESSION_REVOKED_CLOSE_CODE, UNAUTHORIZED_CLOSE_CODE } from '@orbit/shared/events';
import type { SessionGate } from '../../../src/lib/realtime/provider.tsx';
import { endSessionIfRevoked, handleTerminalClose } from '../../../src/lib/realtime/provider.tsx';

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
});
