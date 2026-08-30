import { after } from 'next/server';

export function scheduleSlackEventProcessing(task: () => Promise<void>): void {
  after(task);
}
