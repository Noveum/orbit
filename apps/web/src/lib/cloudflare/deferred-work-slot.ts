import { type DeferredWork, deferredWorkSchema } from '../background/work.ts';

const WORK = 'work';

export interface WorkSlotStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export class DeferredWorkSlot {
  constructor(private readonly storage: WorkSlotStorage) {}

  async schedule(work: DeferredWork, now: number = Date.now()): Promise<void> {
    await this.storage.put(WORK, work);
    if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(now);
  }

  async run(perform: (work: DeferredWork) => Promise<void>): Promise<boolean> {
    const stored = deferredWorkSchema.safeParse(await this.storage.get(WORK));
    if (!stored.success) {
      await this.storage.deleteAll();
      return false;
    }
    await perform(stored.data);
    if ((await this.storage.getAlarm()) === null) await this.storage.deleteAll();
    return true;
  }
}
