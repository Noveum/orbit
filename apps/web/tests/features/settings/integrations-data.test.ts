import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db } from '@orbit/db';
import { bindGithubInstallation, replaceGithubRepositories } from '@orbit/services';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { loadGithubSettings } from '../../../src/features/settings/github-data.ts';
import { loadIntegrationSettings } from '../../../src/features/settings/integrations-data.ts';

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
