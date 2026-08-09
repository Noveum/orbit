import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { githubReach } from '../../../src/features/pulls/data.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Reachable');
});

async function installation(status: 'active' | 'suspended'): Promise<string> {
  const integrationId = `int_${randomUUIDv7()}`;
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId: workspace.organizationId,
    provider: 'github',
    externalId: `install-${randomUUIDv7()}`,
    connectedById: workspace.adminUser.id,
  });
  await db.insert(schema.githubInstallation).values({
    id: `ghi_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    installationId: `inst-${randomUUIDv7()}`,
    integrationId,
    accountLogin: 'noveum',
    accountId: '1',
    accountType: 'Organization',
    repositorySelection: 'all',
    status,
    connectedById: workspace.adminUser.id,
  });
  return integrationId;
}

async function repository(integrationId: string, enabled = true): Promise<void> {
  await db.insert(schema.githubRepositorySync).values({
    id: `repo_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    integrationId,
    teamId: workspace.teamId,
    repositoryId: `${Math.floor(Math.random() * 100000)}`,
    repositoryName: 'noveum/orbit',
    enabled,
  });
}

describe('githubReach', () => {
  it('reports nothing installed on a workspace that never connected', async () => {
    expect(await githubReach(workspace.admin)).toBe('not_installed');
  });

  it('reports no repositories when the app is installed but nothing is tracked', async () => {
    await installation('active');

    expect(await githubReach(workspace.admin)).toBe('no_repositories');
  });

  it('reports connected once a repository is switched on', async () => {
    const integrationId = await installation('active');
    await repository(integrationId);

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('reports suspension even while a repository is still switched on, because nothing arrives', async () => {
    const integrationId = await installation('suspended');
    await repository(integrationId);

    expect(await githubReach(workspace.admin)).toBe('suspended');
  });

  it('ignores a repository that was switched off', async () => {
    const integrationId = await installation('active');
    await repository(integrationId, false);

    expect(await githubReach(workspace.admin)).toBe('no_repositories');
  });

  it('keeps one active installation ahead of a suspended one', async () => {
    await installation('suspended');
    const active = await installation('active');
    await repository(active);

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('still reports connected for a tracked repository predating the installation rows', async () => {
    const integrationId = `int_${randomUUIDv7()}`;
    await db.insert(schema.integration).values({
      id: integrationId,
      organizationId: workspace.organizationId,
      provider: 'github',
      externalId: `install-${randomUUIDv7()}`,
      connectedById: workspace.adminUser.id,
    });
    await repository(integrationId);

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('does not credit an active installation with a repository the suspended one owns', async () => {
    await installation('active');
    const suspended = await installation('suspended');
    await repository(suspended);

    expect(await githubReach(workspace.admin)).toBe('no_repositories');
  });
});
