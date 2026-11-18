export type BusDelivery = (channel: string, message: string) => void | Promise<void>;

export interface RealtimeBus {
  start(deliver: BusDelivery): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  status(): string;
  close(): void;
}

export function createLoopbackBus(): RealtimeBus {
  let deliver: BusDelivery | undefined;
  return {
    start(next: BusDelivery): Promise<void> {
      deliver = next;
      return Promise.resolve();
    },
    async publish(channel: string, message: string): Promise<void> {
      await deliver?.(channel, message);
    },
    status: () => (deliver === undefined ? 'closed' : 'ready'),
    close(): void {
      deliver = undefined;
    },
  };
}
