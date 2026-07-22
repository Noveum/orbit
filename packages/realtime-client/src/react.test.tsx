import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RealtimeProvider, useDeltaHandler, useScopeSubscription } from './react.tsx';

type Handler = (() => void) | null;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: Handler = null;
  onclose: Handler = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
}

function flush() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function Subscriber() {
  useScopeSubscription(['team:team_1']);
  useDeltaHandler(() => undefined);
  return null;
}

function Tree() {
  return (
    <StrictMode>
      <RealtimeProvider url="ws://localhost:3100" token="token_1">
        <Subscriber />
        <Subscriber />
      </RealtimeProvider>
    </StrictMode>
  );
}

describe('RealtimeProvider under StrictMode', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    FakeWebSocket.instances = [];
  });

  it('opens exactly one socket and keeps it across the double mount', async () => {
    render(<Tree />);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    expect(socket?.closed).toBe(false);
    expect(socket?.url).toContain('token=token_1');
  });

  it('subscribes to each scope once no matter how many consumers retain it', async () => {
    render(<Tree />);
    await flush();
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket?.open();
    });

    const subscribes = (socket?.sent ?? [])
      .map((payload) => JSON.parse(payload))
      .filter((message) => message.type === 'subscribe');
    expect(subscribes).toHaveLength(1);
    expect(subscribes[0].scopes).toEqual(['team:team_1']);
  });

  it('closes the socket once the provider truly unmounts', async () => {
    const view = render(<Tree />);
    await flush();
    const socket = FakeWebSocket.instances[0];
    view.unmount();
    await flush();

    expect(socket?.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
