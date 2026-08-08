import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { db, pruneOperationalTables, RETENTION, schema } from '../src/index.ts';

const OLD = new Date(Date.now() - 400 * 24 * 60 * 60_000);
const RECENT = new Date(Date.now() - 60_000);

async function deliveries(): Promise<number> {
  const rows = await db.select().from(schema.webhookDelivery);
  return rows.length;
}

async function seedDelivery(createdAt: Date): Promise<void> {
  await db.insert(schema.webhookDelivery).values({
    id: randomUUIDv7(),
    provider: 'github',
    deliveryId: randomUUIDv7(),
    event: 'pull_request',
    status: 'processed',
    createdAt,
  });
}

describe('pruneOperationalTables', () => {
  beforeEach(async () => {
    await db.delete(schema.webhookDelivery);
  });

  it('deletes rows past the window and keeps the rest', async () => {
    await seedDelivery(OLD);
    await seedDelivery(OLD);
    await seedDelivery(RECENT);

    const pruned = await pruneOperationalTables(db, [{ table: 'webhook_delivery', days: 30 }]);

    expect(pruned).toEqual([{ table: 'webhook_delivery', days: 30, deleted: 2 }]);
    expect(await deliveries()).toBe(1);
  });

  it('deletes nothing when everything is inside the window', async () => {
    await seedDelivery(RECENT);

    const pruned = await pruneOperationalTables(db, [{ table: 'webhook_delivery', days: 30 }]);

    expect(pruned[0]?.deleted).toBe(0);
    expect(await deliveries()).toBe(1);
  });

  it('refuses a table name that is not one', async () => {
    await expect(
      pruneOperationalTables(db, [{ table: 'webhook_delivery; drop table issue', days: 30 }]),
    ).rejects.toThrow('is not a table name');
  });

  it('refuses a window that would delete everything', async () => {
    await expect(
      pruneOperationalTables(db, [{ table: 'webhook_delivery', days: 0 }]),
    ).rejects.toThrow('whole number of days');
    await expect(
      pruneOperationalTables(db, [{ table: 'webhook_delivery', days: -5 }]),
    ).rejects.toThrow('whole number of days');
  });

  it('only ever names operational tables, never product data', () => {
    expect(RETENTION.map((window) => window.table).toSorted()).toEqual([
      'web_vital',
      'webhook_delivery',
    ]);
    for (const window of RETENTION) {
      expect(window.days).toBeGreaterThanOrEqual(30);
    }
  });
});
