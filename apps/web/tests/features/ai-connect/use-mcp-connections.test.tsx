import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  MCP_CONNECTION_POLL_MS,
  useMcpConnections,
} from '@/features/ai-connect/use-mcp-connections.ts';

const realFetch = globalThis.fetch;
const realVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const CLAUDE = { id: 'g1', clientName: 'Claude', organizationName: 'Acme' };

let pending: ((response: Response) => void)[] = [];
let calls = 0;

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

function respond(index: number, body: unknown, status = 200): void {
  const resolve = pending[index];
  if (resolve === undefined) throw new Error(`no request ${index}`);
  resolve(Response.json(body, { status }));
}

beforeEach(() => {
  pending = [];
  calls = 0;
  setVisibility('visible');
  globalThis.fetch = mock(() => {
    calls += 1;
    return new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
  Object.defineProperty(
    document,
    'visibilityState',
    realVisibility ?? { configurable: true, value: 'visible' },
  );
});

describe('useMcpConnections', () => {
  it('checks on mount and again on every poll interval while the tab is visible', async () => {
    jest.useFakeTimers();
    renderHook(() => useMcpConnections());
    expect(calls).toBe(1);
    await act(async () => {
      respond(0, { connections: [] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(MCP_CONNECTION_POLL_MS);
    });
    expect(calls).toBe(2);
  });

  it('does not poll a hidden tab, and checks as soon as it becomes visible again', async () => {
    jest.useFakeTimers();
    renderHook(() => useMcpConnections());
    await act(async () => {
      respond(0, { connections: [] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    setVisibility('hidden');
    act(() => {
      jest.advanceTimersByTime(MCP_CONNECTION_POLL_MS * 3);
    });
    expect(calls).toBe(1);
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls).toBe(2);
  });

  it('stops polling and listening once unmounted', async () => {
    jest.useFakeTimers();
    const { unmount } = renderHook(() => useMcpConnections());
    await act(async () => {
      respond(0, { connections: [] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(MCP_CONNECTION_POLL_MS * 3);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls).toBe(1);
  });

  it('reports the connected clients', async () => {
    const { result } = renderHook(() => useMcpConnections());
    act(() => respond(0, { connections: [CLAUDE] }));
    await waitFor(() => expect(result.current.connections).toEqual([CLAUDE]));
    expect(result.current.error).toBeNull();
  });

  it('never runs two checks at once, so a focus and a visibility change share one request', () => {
    renderHook(() => useMcpConnections());
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls).toBe(1);
  });

  it('checks again after the previous check has finished', async () => {
    renderHook(() => useMcpConnections());
    await act(async () => {
      respond(0, { connections: [] });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(calls).toBe(2);
  });

  it('stops checking once a client is connected', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useMcpConnections());
    await act(async () => {
      respond(0, { connections: [CLAUDE] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.connections).toEqual([CLAUDE]);
    act(() => {
      jest.advanceTimersByTime(MCP_CONNECTION_POLL_MS * 3);
      window.dispatchEvent(new Event('focus'));
    });
    expect(calls).toBe(1);
  });

  it('surfaces a failed check instead of hiding it', async () => {
    const { result } = renderHook(() => useMcpConnections());
    act(() => respond(0, { error: { message: 'Not signed in' } }, 401));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.connections).toEqual([]);
  });

  it('treats a response of the wrong shape as an error', async () => {
    const { result } = renderHook(() => useMcpConnections());
    act(() => respond(0, { connections: [{ id: 1 }] }));
    await waitFor(() => expect(result.current.error).toBe('Unexpected response from Orbit.'));
  });
});
