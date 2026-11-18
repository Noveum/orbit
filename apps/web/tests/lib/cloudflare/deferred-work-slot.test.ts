import { describe, expect, it } from 'bun:test';
import type { DeferredWork } from '../../../src/lib/background/work.ts';
import {
  DeferredWorkSlot,
  type WorkSlotStorage,
} from '../../../src/lib/cloudflare/deferred-work-slot.ts';

const BACKFILL: DeferredWork = { kind: 'pull-request-backfill', organizationId: 'org_1' };
const NOW = 1_800_000_000_000;

interface FakeStorage extends WorkSlotStorage {
  readonly values: Map<string, unknown>;
  readonly alarmsSet: number[];
  alarm: number | null;
  fire(): void;
}

function fakeStorage(): FakeStorage {
  const values = new Map<string, unknown>();
  const storage: FakeStorage = {
    values,
    alarmsSet: [],
    alarm: null,
    fire() {
      storage.alarm = null;
    },
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    deleteAll: () => {
      values.clear();
      storage.alarm = null;
      return Promise.resolve();
    },
    getAlarm: () => Promise.resolve(storage.alarm),
    setAlarm: (scheduledTime) => {
      storage.alarm = scheduledTime;
      storage.alarmsSet.push(scheduledTime);
      return Promise.resolve();
    },
  };
  return storage;
}

describe('the deferred work slot', () => {
  it('stores the work and sets an alarm for now', async () => {
    const storage = fakeStorage();
    await new DeferredWorkSlot(storage).schedule(BACKFILL, NOW);
    expect(storage.values.get('work')).toEqual(BACKFILL);
    expect(storage.alarmsSet).toEqual([NOW]);
  });

  it('does not stack a second alarm while one is already waiting', async () => {
    const storage = fakeStorage();
    const slot = new DeferredWorkSlot(storage);
    await slot.schedule(BACKFILL, NOW);
    await slot.schedule(BACKFILL, NOW + 500);
    expect(storage.alarmsSet).toEqual([NOW]);
  });

  it('runs the stored work when the alarm fires and leaves nothing behind', async () => {
    const storage = fakeStorage();
    const slot = new DeferredWorkSlot(storage);
    await slot.schedule(BACKFILL, NOW);
    storage.fire();
    const performed: DeferredWork[] = [];
    const ran = await slot.run((work) => {
      performed.push(work);
      return Promise.resolve();
    });
    expect(ran).toBe(true);
    expect(performed).toEqual([BACKFILL]);
    expect(storage.values.size).toBe(0);
  });

  it('keeps work that was scheduled again while the alarm was running', async () => {
    const storage = fakeStorage();
    const slot = new DeferredWorkSlot(storage);
    await slot.schedule(BACKFILL, NOW);
    storage.fire();
    await slot.run(async () => {
      await slot.schedule(BACKFILL, NOW + 1_000);
    });
    expect(storage.values.get('work')).toEqual(BACKFILL);
    expect(storage.alarm).toBe(NOW + 1_000);
  });

  it('keeps the work for the retry when running it throws', async () => {
    const storage = fakeStorage();
    const slot = new DeferredWorkSlot(storage);
    await slot.schedule(BACKFILL, NOW);
    storage.fire();
    await expect(slot.run(() => Promise.reject(new Error('interrupted')))).rejects.toThrow(
      'interrupted',
    );
    expect(storage.values.get('work')).toEqual(BACKFILL);
  });

  it('clears a slot whose stored work is not something it can run', async () => {
    const storage = fakeStorage();
    await storage.put('work', { kind: 'unknown' });
    let performed = false;
    const ran = await new DeferredWorkSlot(storage).run(() => {
      performed = true;
      return Promise.resolve();
    });
    expect(ran).toBe(false);
    expect(performed).toBe(false);
    expect(storage.values.size).toBe(0);
  });
});
