import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { organization, webhookDelivery, webhookDeliveryQuarantine } from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import {
  decryptGithubWebhookQuarantinePayload,
  encryptGithubWebhookQuarantinePayload,
  GithubWebhookQuarantineError,
  quarantineGithubWebhookDelivery,
} from '../../src/github/quarantine.ts';
import { withRollback } from '../../src/test-database.ts';

const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const identity = {
  deliveryId: 'whd_019c',
  provider: 'github' as const,
  providerDeliveryId: 'provider-delivery-42',
};
const payload = {
  version: 1 as const,
  provider: 'github' as const,
  eventName: 'check_run',
  providerDeliveryId: identity.providerDeliveryId,
  rawPayload: '{"private":"signed provider body"}',
};

beforeEach(() => {
  process.env['BETTER_AUTH_SECRET'] = 'github-quarantine-test-secret-with-safe-length';
});

afterAll(() => {
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
});

describe('GitHub webhook quarantine encryption', () => {
  it('round trips the validated envelope without storing plaintext', () => {
    const encrypted = encryptGithubWebhookQuarantinePayload(payload, identity);

    expect(encrypted.version).toBe(1);
    expect(JSON.stringify(encrypted)).not.toContain(payload.rawPayload);
    expect(decryptGithubWebhookQuarantinePayload(encrypted, identity)).toEqual(payload);
  });

  it('uses a fresh nonce for the same provider delivery', () => {
    const first = encryptGithubWebhookQuarantinePayload(payload, identity);
    const second = encryptGithubWebhookQuarantinePayload(payload, identity);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('binds ciphertext to the parent and provider delivery identity', () => {
    const encrypted = encryptGithubWebhookQuarantinePayload(payload, identity);

    expect(() =>
      decryptGithubWebhookQuarantinePayload(encrypted, {
        ...identity,
        deliveryId: 'whd_other',
      }),
    ).toThrow(GithubWebhookQuarantineError);
    expect(() =>
      decryptGithubWebhookQuarantinePayload(encrypted, {
        ...identity,
        providerDeliveryId: 'provider-delivery-other',
      }),
    ).toThrow(GithubWebhookQuarantineError);
  });

  it('fails closed when the envelope is changed or the key is unavailable', () => {
    const encrypted = encryptGithubWebhookQuarantinePayload(payload, identity);
    const firstCharacter = encrypted.ciphertext.at(0);
    if (firstCharacter === undefined) throw new Error('Expected ciphertext');
    const changedCharacter = firstCharacter === 'A' ? 'B' : 'A';

    expect(() =>
      decryptGithubWebhookQuarantinePayload(
        { ...encrypted, ciphertext: `${changedCharacter}${encrypted.ciphertext.slice(1)}` },
        identity,
      ),
    ).toThrow(GithubWebhookQuarantineError);

    delete process.env['BETTER_AUTH_SECRET'];
    expect(() => encryptGithubWebhookQuarantinePayload(payload, identity)).toThrow(
      GithubWebhookQuarantineError,
    );
  });
});

describe('GitHub webhook quarantine persistence', () => {
  it('terminally finalizes the active parent claim with one linked encrypted row', async () => {
    await withRollback(async (tx) => {
      const suffix = randomUUIDv7();
      const organizationId = `org_${suffix}`;
      const deliveryId = `whd_${suffix}`;
      const claimToken = `claim_${suffix}`;
      await tx.insert(organization).values({
        id: organizationId,
        name: 'Acme',
        slug: `acme-${suffix.toLowerCase()}`,
      });
      await tx.insert(webhookDelivery).values({
        id: deliveryId,
        provider: 'github',
        deliveryId: `provider_${suffix}`,
        event: 'check_run',
        organizationId,
        status: 'processing',
        claimToken,
      });

      const result = await quarantineGithubWebhookDelivery(tx, {
        claim: { id: deliveryId, claimToken },
        rawPayload: payload.rawPayload,
        failure: { code: 'invalid_check_run_app', path: 'check_run.app.id' },
      });
      const [parent] = await tx
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, deliveryId));

      expect(parent).toMatchObject({ status: 'quarantined', error: 'invalid_check_run_app' });
      expect(result).toMatchObject({
        deliveryId,
        organizationId,
        scopeKind: 'organization',
        reasonCode: 'invalid_check_run_app',
        reasonPath: 'check_run.app.id',
        encryptionKeyVersion: 1,
        parserSchemaVersion: 1,
      });
      expect(JSON.stringify(result.payloadEnvelope)).not.toContain(payload.rawPayload);
      expect(
        decryptGithubWebhookQuarantinePayload(result.payloadEnvelope, {
          deliveryId,
          provider: 'github',
          providerDeliveryId: `provider_${suffix}`,
        }),
      ).toMatchObject({ rawPayload: payload.rawPayload });
    });
  });

  it('rejects a stale claim without changing the parent or inserting quarantine state', async () => {
    await withRollback(async (tx) => {
      const suffix = randomUUIDv7();
      const deliveryId = `whd_${suffix}`;
      await tx.insert(webhookDelivery).values({
        id: deliveryId,
        provider: 'github',
        deliveryId: `provider_${suffix}`,
        event: 'check_run',
        status: 'processing',
        claimToken: `current_${suffix}`,
      });

      await expect(
        quarantineGithubWebhookDelivery(tx, {
          claim: { id: deliveryId, claimToken: `stale_${suffix}` },
          rawPayload: payload.rawPayload,
          failure: { code: 'invalid_check_run_app', path: 'check_run.app.id' },
        }),
      ).rejects.toBeInstanceOf(GithubWebhookQuarantineError);

      const [parent] = await tx
        .select({ status: webhookDelivery.status })
        .from(webhookDelivery)
        .where(eq(webhookDelivery.id, deliveryId));
      const quarantines = await tx
        .select()
        .from(webhookDeliveryQuarantine)
        .where(eq(webhookDeliveryQuarantine.deliveryId, deliveryId));

      expect(parent?.status).toBe('processing');
      expect(quarantines).toEqual([]);
    });
  });
});
