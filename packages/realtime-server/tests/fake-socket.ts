import type { ServerMessage } from '@orbit/shared/events';
import type { RealtimeSocket } from '../src/socket.ts';

const OPEN = 1;
const CLOSED = 3;

export interface Closure {
  readonly code: number;
  readonly reason: string;
}

export class FakeSocket implements RealtimeSocket {
  readyState = OPEN;
  readonly sent: ServerMessage[] = [];
  readonly closures: Closure[] = [];
  terminated = 0;
  pings = 0;
  buffered = 0;

  bufferedAmount(): number {
    return this.buffered;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closures.push({ code, reason });
    this.readyState = CLOSED;
  }

  terminate(): void {
    this.terminated += 1;
    this.readyState = CLOSED;
  }

  ping(): void {
    this.pings += 1;
  }

  frames<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter(
      (message): message is Extract<ServerMessage, { type: T }> => message.type === type,
    );
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.frames(type).at(-1);
  }
}

export async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) await new Promise(setImmediate);
}

export async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}
