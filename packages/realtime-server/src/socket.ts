import type { ServerWebSocket } from 'bun';

export const SOCKET_OPEN = 1;

export interface RealtimeSocket {
  readonly readyState: number;
  bufferedAmount(): number;
  send(data: string): void;
  close(code: number, reason: string): void;
  terminate(): void;
  ping(): void;
}

export interface NodeCompatibleSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}

export function fromBunSocket<T>(socket: ServerWebSocket<T>): RealtimeSocket {
  return {
    get readyState(): number {
      return socket.readyState;
    },
    bufferedAmount: () => socket.getBufferedAmount(),
    send: (data: string) => {
      socket.send(data);
    },
    close: (code: number, reason: string) => {
      socket.close(code, reason);
    },
    terminate: () => {
      socket.terminate();
    },
    ping: () => {
      socket.ping();
    },
  };
}

export function fromNodeSocket(socket: NodeCompatibleSocket): RealtimeSocket {
  return {
    get readyState(): number {
      return socket.readyState;
    },
    bufferedAmount: () => socket.bufferedAmount,
    send: (data: string) => {
      socket.send(data);
    },
    close: (code: number, reason: string) => {
      socket.close(code, reason);
    },
    terminate: () => {
      socket.terminate();
    },
    ping: () => {
      socket.ping();
    },
  };
}
