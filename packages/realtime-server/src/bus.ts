export type BusDelivery = (channel: string, message: string) => void;

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
    publish(channel: string, message: string): Promise<void> {
      deliver?.(channel, message);
      return Promise.resolve();
    },
    status: () => (deliver === undefined ? 'closed' : 'ready'),
    close(): void {
      deliver = undefined;
    },
  };
}
