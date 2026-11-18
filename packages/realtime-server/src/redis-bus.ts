import {
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
} from '@orbit/shared/events';
import { Redis } from 'ioredis';
import type { BusDelivery, RealtimeBus } from './bus.ts';
import { errorFields, logger } from './logger.ts';

export function createRedisBus(redisUrl: string): RealtimeBus {
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  let closing = false;

  return {
    async start(deliver: BusDelivery): Promise<void> {
      subscriber.on('message', deliver);
      await subscriber.subscribe(
        REDIS_DELTA_CHANNEL,
        REDIS_PRESENCE_CHANNEL,
        REDIS_CONTROL_CHANNEL,
      );
      subscriber.on('error', (error: Error): void => {
        if (!closing) logger.error('redis subscriber error', errorFields(error));
      });
      publisher.on('error', (error: Error): void => {
        if (!closing) logger.error('redis publisher error', errorFields(error));
      });
    },
    async publish(channel: string, message: string): Promise<void> {
      await publisher.publish(channel, message);
    },
    status: () => subscriber.status,
    close(): void {
      closing = true;
      subscriber.disconnect();
      publisher.disconnect();
    },
  };
}
