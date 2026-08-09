import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { bindGithubInstallation, replaceGithubRepositories } from '@orbit/services';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { loadGithubSettings } from '../../../src/features/settings/github-data.ts';
import {
  loadGithubDeliveries,
  loadIntegrationSettings,
} from '../../../src/features/settings/integrations-data.ts';

const INSTALLATION_ID = '151887625';
const SECRET_REPOSITORY = 'Noveum/unannounced-acquisition';

let workspace: Workspace;

async function seedPrivateCatalogue(): Promise<void> {
  await db.transaction(async (tx) => {
    const installation = await bindGithubInstallation(tx, {
      organizationId: workspace.organizationId,
      connectedById: workspace.adminUser.id,
      account: {
        installationId: INSTALLATION_ID,
        accountLogin: 'Noveum',
        accountId: '192082188',
        accountType: 'Organization',
        repositorySelection: 'all',
        suspended: false,
      },
    });
    await replaceGithubRepositories(tx, {
      installation,
      repositories: [
        {
          repositoryId: '900712888',
          repositoryName: SECRET_REPOSITORY,
          name: 'unannounced-acquisition',
          ownerLogin: 'Noveum',
          private: true,
          archived: false,
          defaultBranch: 'main',
          htmlUrl: `https://github.com/${SECRET_REPOSITORY}`,
        },
      ],
    });
  });
}

async function principalWithRole(role: OrgRole): Promise<Principal> {
  const { principal } = await addMember(workspace, role, { name: `${role} viewer` });
  return principal;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Noveum');
  await seedPrivateCatalogue();
});

describe('loadIntegrationSettings', () => {
  it('gives an admin the repository catalogue', async () => {
    const settings = await loadIntegrationSettings(workspace.admin);

    expect(settings.github.connected).toBe(true);
    expect(settings.github.repositories.map((entry) => entry.fullName)).toEqual([
      SECRET_REPOSITORY,
    ]);
  });

  for (const role of ['guest', 'contributor', 'member'] as const) {
    it(`hands a ${role} no repository name at all`, async () => {
      const principal = await principalWithRole(role);

      const settings = await loadIntegrationSettings(principal);

      expect(settings.github.repositories).toEqual([]);
      expect(settings.github.installations).toEqual([]);
      expect(settings.github.connected).toBe(false);
      expect(JSON.stringify(settings)).not.toContain('unannounced-acquisition');
      expect(JSON.stringify(settings)).not.toContain(INSTALLATION_ID);
    });
  }

  it('withholds the workspace Slack wiring from anyone who cannot manage integrations', async () => {
    const principal = await principalWithRole('member');

    const settings = await loadIntegrationSettings(principal);

    expect(settings.channels).toEqual([]);
    expect(settings.teams).toEqual([]);
    expect(settings.slackHasToken).toBe(false);
  });
});

describe('loadGithubSettings', () => {
  it('refuses outright when the caller cannot manage integrations', async () => {
    const principal = await principalWithRole('guest');

    await expect(loadGithubSettings(principal)).rejects.toThrow(/integration manage/);
  });

  it('refuses a forced refresh from a member as well as a read', async () => {
    const principal = await principalWithRole('member');

    await expect(loadGithubSettings(principal, { refresh: true })).rejects.toThrow(
      /integration manage/,
    );
  });

  it('still serves an admin', async () => {
    const settings = await loadGithubSettings(workspace.admin);

    expect(settings.repositories.map((entry) => entry.fullName)).toEqual([SECRET_REPOSITORY]);
  });
});
describe('loadGithubDeliveries', () => {
  async function recordDelivery(overrides: {
    readonly id: string;
    readonly provider?: string;
    readonly event?: string;
    readonly status?: string;
    readonly error?: string | null;
    readonly createdAt?: Date;
    readonly organizationId?: string;
  }): Promise<void> {
    await db.insert(schema.webhookDelivery).values({
      id: overrides.id,
      provider: overrides.provider ?? 'github',
      deliveryId: `delivery-${overrides.id}`,
      event: overrides.event ?? 'pull_request',
      status: overrides.status ?? 'processed',
      error: overrides.error ?? null,
      organizationId: overrides.organizationId ?? workspace.organizationId,
      createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  it('never hands one workspace the delivery log of another', async () => {
    const neighbour = await createWorkspace('somebody-else');
    await recordDelivery({ id: 'mine' });
    await recordDelivery({ id: 'theirs', organizationId: neighbour.organizationId });

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries.map((entry) => entry.id)).toEqual(['mine']);
    expect(await loadGithubDeliveries(neighbour.admin)).toHaveLength(1);
  });

  it('leaves a delivery nobody could attribute out of every workspace', async () => {
    await recordDelivery({ id: 'mine' });
    await recordDelivery({ id: 'unattributed' });
    await db
      .update(schema.webhookDelivery)
      .set({ organizationId: null })
      .where(eq(schema.webhookDelivery.id, 'unattributed'));

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries.map((entry) => entry.id)).toEqual(['mine']);
  });

  it('gives an admin the deliveries that arrived', async () => {
    await recordDelivery({ id: 'del_1', status: 'ignored', error: 'no_issue_identifier' });

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('ignored');
    expect(deliveries[0]?.reason).toBe('no_issue_identifier');
    expect(deliveries[0]?.event).toBe('pull_request');
  });

  for (const role of ['member', 'guest'] as const) {
    it(`tells a ${role} nothing, because a delivery log is not theirs to read`, async () => {
      await recordDelivery({ id: 'del_1' });
      const principal = await principalWithRole(role);

      expect(await loadGithubDeliveries(principal)).toEqual([]);
    });
  }

  it('leaves another provider out rather than calling its delivery a GitHub one', async () => {
    await recordDelivery({ id: 'del_github' });
    await recordDelivery({ id: 'del_slack', provider: 'slack', event: 'message' });

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries.map((entry) => entry.id)).toEqual(['del_github']);
  });

  it('puts the newest delivery first, because that is the one being diagnosed', async () => {
    await recordDelivery({ id: 'older', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await recordDelivery({ id: 'newest', createdAt: new Date('2026-03-01T00:00:00.000Z') });
    await recordDelivery({ id: 'middle', createdAt: new Date('2026-02-01T00:00:00.000Z') });

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries.map((entry) => entry.id)).toEqual(['newest', 'middle', 'older']);
  });

  it('stops at twenty, so one busy hour cannot bury the panel', async () => {
    for (let index = 0; index < 25; index += 1) {
      await recordDelivery({
        id: `del_${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries).toHaveLength(20);
    expect(deliveries[0]?.id).toBe('del_24');
  });

  it('hands the arrival time over as an ISO string the client can parse', async () => {
    await recordDelivery({ id: 'del_1', createdAt: new Date('2026-05-04T09:30:00.000Z') });

    const deliveries = await loadGithubDeliveries(workspace.admin);

    expect(deliveries[0]?.receivedAt).toBe('2026-05-04T09:30:00.000Z');
    expect(new Date(deliveries[0]?.receivedAt ?? '').toISOString()).toBe(
      '2026-05-04T09:30:00.000Z',
    );
  });
});
