import { EventEmitter } from 'node:events';

const bus = new Set<FakeRedis>();

export class FakeRedis extends EventEmitter {
  status = 'ready';
  readonly published: { channel: string; message: string }[] = [];
  private readonly channels = new Set<string>();

  constructor(
    readonly url: string,
    readonly options: Record<string, unknown> = {},
  ) {
    super();
    bus.add(this);
  }

  subscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) this.channels.add(channel);
    return Promise.resolve(this.channels.size);
  }

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    let reached = 0;
    for (const peer of bus) {
      if (!peer.channels.has(channel)) continue;
      reached += 1;
      queueMicrotask(() => peer.emit('message', channel, message));
    }
    return Promise.resolve(reached);
  }

  disconnect(): void {
    this.status = 'end';
    this.channels.clear();
    bus.delete(this);
  }
}

export function resetFakeRedis(): void {
  for (const peer of [...bus]) peer.disconnect();
  bus.clear();
}
