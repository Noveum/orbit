import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
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

async function repository(
  integrationId: string,
  enabled = true,
  repositoryId = `${Math.floor(Math.random() * 100000)}`,
): Promise<string> {
  await db.insert(schema.githubRepositorySync).values({
    id: `repo_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    integrationId,
    teamId: workspace.teamId,
    repositoryId,
    repositoryName: 'noveum/orbit',
    enabled,
  });
  return repositoryId;
}

async function catalogued(
  integrationId: string,
  repositoryId: string,
  archived = false,
): Promise<void> {
  const [row] = await db
    .select({ id: schema.githubInstallation.id })
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.integrationId, integrationId))
    .limit(1);
  if (row === undefined) throw new Error('that integration has no installation row');
  await db.insert(schema.githubRepository).values({
    id: `ghr_${randomUUIDv7()}`,
    organizationId: workspace.organizationId,
    installationRowId: row.id,
    repositoryId,
    fullName: `noveum/repo-${repositoryId}`,
    archived,
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

  it('reports untracked repositories when the app can see one nobody switched on', async () => {
    const integrationId = await installation('active');
    const tracked = await repository(integrationId);
    await catalogued(integrationId, tracked);
    await catalogued(integrationId, 'seen-but-never-switched-on');

    expect(await githubReach(workspace.admin)).toBe('repositories_untracked');
  });

  it('stays connected when every repository the app can see is tracked', async () => {
    const integrationId = await installation('active');
    const tracked = await repository(integrationId);
    await catalogued(integrationId, tracked);

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('does not nag about an archived repository, which will never open a pull request', async () => {
    const integrationId = await installation('active');
    const tracked = await repository(integrationId);
    await catalogued(integrationId, tracked);
    await catalogued(integrationId, 'long-since-archived', true);

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('does not nag about a repository only a suspended installation can see', async () => {
    const active = await installation('active');
    const suspended = await installation('suspended');
    const tracked = await repository(active);
    await catalogued(active, tracked);
    await catalogued(suspended, 'visible-only-while-suspended');

    expect(await githubReach(workspace.admin)).toBe('connected');
  });

  it('keeps reporting no repositories rather than untracked when nothing is switched on at all', async () => {
    const integrationId = await installation('active');
    await catalogued(integrationId, 'seen-but-never-switched-on');

    expect(await githubReach(workspace.admin)).toBe('no_repositories');
  });
});
