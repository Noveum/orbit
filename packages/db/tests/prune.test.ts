import { beforeEach, describe, expect, it } from 'bun:test';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { db, eq, pruneOperationalTables, RETENTION, schema } from '../src/index.ts';

const OLD = new Date(Date.now() - 400 * 24 * 60 * 60_000);
const RECENT = new Date(Date.now() - 60_000);

async function deliveries(): Promise<number> {
  const rows = await db.select().from(schema.webhookDelivery);
  return rows.length;
}

async function seedDelivery(createdAt: Date): Promise<string> {
  const id = randomUUIDv7();
  await db.insert(schema.webhookDelivery).values({
    id,
    provider: 'github',
    deliveryId: randomUUIDv7(),
    event: 'pull_request',
    status: 'processed',
    createdAt,
  });
  return id;
}

async function seedAuditedDelivery(createdAt: Date): Promise<string> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  const integrationId = `int_${suffix}`;
  const repositorySyncId = `repo_${suffix}`;
  const deliveryId = `whd_${suffix}`;
  await db.insert(schema.user).values({
    id: userId,
    name: 'Owner',
    email: `${suffix}@orbit.test`,
    handle: `owner-${suffix.toLowerCase()}`,
  });
  await db.insert(schema.organization).values({
    id: organizationId,
    name: 'Acme',
    slug: `acme-${suffix.toLowerCase()}`,
  });
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId,
    provider: 'github',
    externalId: `installation-${suffix}`,
    connectedById: userId,
  });
  await db.insert(schema.githubRepositorySync).values({
    id: repositorySyncId,
    organizationId,
    integrationId,
    repositoryId: `repository-${suffix}`,
    repositoryName: 'acme/web',
  });
  await db.insert(schema.webhookDelivery).values({
    id: deliveryId,
    provider: 'github',
    deliveryId: `provider-${suffix}`,
    event: 'check_run',
    organizationId,
    status: 'processed',
    createdAt,
  });
  await db.insert(schema.githubCheckActivity).values({
    id: `activity_${suffix}`,
    organizationId,
    repositorySyncId,
    headSha: '1111111111111111111111111111111111111111',
    sourceKind: 'check_run',
    contextKey: `context-${suffix}`,
    providerObjectId: `check-${suffix}`,
    providerUpdatedAt: createdAt,
    webhookDeliveryId: deliveryId,
    state: 'success',
    occurredAt: createdAt,
    createdAt,
  });
  return deliveryId;
}

describe('pruneOperationalTables', () => {
  beforeEach(async () => {
    await db.delete(schema.webhookDeliveryQuarantine);
    await db.delete(schema.githubCheckActivity);
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

  it('exempts terminal quarantine parents from ordinary retention', async () => {
    await seedDelivery(OLD);
    const quarantinedId = await seedDelivery(OLD);
    await db
      .update(schema.webhookDelivery)
      .set({ status: 'quarantined' })
      .where(eq(schema.webhookDelivery.id, quarantinedId));
    await db.insert(schema.webhookDeliveryQuarantine).values({
      deliveryId: quarantinedId,
      scopeKind: 'unresolved',
      scopeKeyHash: 'quarantine-scope-hash',
      payloadEnvelope: { version: 1, iv: 'AA', ciphertext: 'AA', tag: 'AA' },
      encryptionKeyVersion: 1,
      parserSchemaVersion: 1,
      reasonCode: 'invalid_head_sha',
      reasonPath: 'check_run.head_sha',
      quarantinedAt: OLD,
      createdAt: OLD,
      updatedAt: OLD,
    });

    const pruned = await pruneOperationalTables(db, [{ table: 'webhook_delivery', days: 30 }]);

    expect(pruned).toEqual([{ table: 'webhook_delivery', days: 30, deleted: 1 }]);
    const rows = await db.select().from(schema.webhookDelivery);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(quarantinedId);
  });

  it('exempts processed parents retained by GitHub check audit provenance', async () => {
    await seedDelivery(OLD);
    const auditedId = await seedAuditedDelivery(OLD);

    const pruned = await pruneOperationalTables(db, [{ table: 'webhook_delivery', days: 30 }]);

    expect(pruned).toEqual([{ table: 'webhook_delivery', days: 30, deleted: 1 }]);
    const rows = await db.select().from(schema.webhookDelivery);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(auditedId);
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
