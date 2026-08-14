import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  githubReach,
  loadPullRequestDetail,
  loadPullRequestPage,
  loadPullRequests,
} from '@/features/pulls/data.ts';
import { refreshPullRequestHistory } from '@/features/pulls/github-refresh.ts';

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

async function mirroredPull(
  integrationId: string,
  repositoryId: string,
  number: number,
): Promise<string> {
  const [repositorySync] = await db
    .select({ id: schema.githubRepositorySync.id })
    .from(schema.githubRepositorySync)
    .where(
      and(
        eq(schema.githubRepositorySync.integrationId, integrationId),
        eq(schema.githubRepositorySync.repositoryId, repositoryId),
      ),
    )
    .limit(1);
  if (repositorySync === undefined) throw new Error('the repository is not tracked');
  const id = `ghp_${randomUUIDv7()}`;
  await db.insert(schema.githubPullRequest).values({
    id,
    organizationId: workspace.organizationId,
    repositorySyncId: repositorySync.id,
    repositoryId,
    repositoryName: 'noveum/orbit',
    number,
    title: `Pull ${number}`,
    url: `https://github.com/noveum/orbit/pull/${number}`,
  });
  return id;
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

describe('loadPullRequests', () => {
  it('merges direct and legacy task links without losing or duplicating context', async () => {
    const integrationId = await installation('active');
    const repositoryId = await repository(integrationId);
    const pullRequestId = await mirroredPull(integrationId, repositoryId, 54);
    const directIssueId = `iss_${randomUUIDv7()}`;
    const dualIssueId = `iss_${randomUUIDv7()}`;
    await db.insert(schema.issue).values([
      {
        id: directIssueId,
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        number: 54,
        identifier: 'REA-54',
        title: 'Keep direct pull request context',
        stateId: stateNamed(workspace, 'Todo').id,
        creatorId: workspace.adminUser.id,
      },
      {
        id: dualIssueId,
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        number: 55,
        identifier: 'REA-55',
        title: 'Deduplicate migrated pull request context',
        stateId: stateNamed(workspace, 'Todo').id,
        creatorId: workspace.adminUser.id,
      },
    ]);
    await db.insert(schema.gitLink).values([
      {
        id: `git_${randomUUIDv7()}`,
        organizationId: workspace.organizationId,
        issueId: directIssueId,
        kind: 'pull_request',
        externalId: 'pr:noveum/orbit:direct:rea-54',
        pullRequestId,
        number: null,
        repository: 'noveum/orbit',
        title: 'Keep direct pull request context',
        url: 'https://github.com/noveum/orbit/pull/54',
      },
      {
        id: `git_${randomUUIDv7()}`,
        organizationId: workspace.organizationId,
        issueId: dualIssueId,
        kind: 'pull_request',
        externalId: 'pr:noveum/orbit:direct:rea-55',
        pullRequestId,
        number: 54,
        repository: 'noveum/orbit',
        title: 'Deduplicate migrated pull request context',
        url: 'https://github.com/noveum/orbit/pull/54',
      },
      {
        id: `git_${randomUUIDv7()}`,
        organizationId: workspace.organizationId,
        issueId: dualIssueId,
        kind: 'pull_request',
        externalId: 'pr:noveum/orbit#54:rea-55',
        number: 54,
        repository: 'noveum/orbit',
        title: 'Deduplicate migrated pull request context',
        url: 'https://github.com/noveum/orbit/pull/54',
      },
    ]);

    const page = await loadPullRequestPage(workspace.admin, 1);
    const detail = await loadPullRequestDetail(workspace.admin, pullRequestId);

    expect(page.total).toBe(1);
    expect(page.pulls[0]?.linkedIssues.map((context) => context.identifier).sort()).toEqual([
      'REA-54',
      'REA-55',
    ]);
    expect(detail?.linkedIssues.map((context) => context.identifier).sort()).toEqual([
      'REA-54',
      'REA-55',
    ]);
  });

  it('keeps the PR visible but hides linked task context after team access is removed', async () => {
    const teammate = await addMember(workspace, 'member');
    const integrationId = await installation('active');
    const repositoryId = await repository(integrationId);
    await mirroredPull(integrationId, repositoryId, 51);
    const issueId = `iss_${randomUUIDv7()}`;
    await db.insert(schema.issue).values({
      id: issueId,
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      number: 51,
      identifier: 'REA-51',
      title: 'Keep pull request access current',
      stateId: stateNamed(workspace, 'Todo').id,
      creatorId: teammate.user.id,
      assigneeId: teammate.user.id,
    });
    await db.insert(schema.gitLink).values({
      id: `git_${randomUUIDv7()}`,
      organizationId: workspace.organizationId,
      issueId,
      kind: 'pull_request',
      externalId: 'pr:noveum/orbit#51:rea-51',
      number: 51,
      repository: 'noveum/orbit',
      title: 'Keep pull request access current',
      url: 'https://github.com/noveum/orbit/pull/51',
    });

    await db.delete(schema.teamMember).where(eq(schema.teamMember.userId, teammate.user.id));

    const teammatePulls = await loadPullRequests(teammate.principal);
    expect(teammatePulls).toHaveLength(1);
    expect(teammatePulls[0]?.linkedIssues).toHaveLength(0);
    const adminPulls = await loadPullRequests(workspace.admin);
    expect(adminPulls).toHaveLength(1);
    expect(adminPulls[0]?.linkedIssues[0]?.identifier).toBe('REA-51');
  });

  it('does not trust a stale admin principal after the admin leaves the workspace', async () => {
    const integrationId = await installation('active');
    const repositoryId = await repository(integrationId);
    await mirroredPull(integrationId, repositoryId, 52);
    const issueId = `iss_${randomUUIDv7()}`;
    await db.insert(schema.issue).values({
      id: issueId,
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      number: 52,
      identifier: 'REA-52',
      title: 'Keep admin pull request access current',
      stateId: stateNamed(workspace, 'Todo').id,
      creatorId: workspace.adminUser.id,
    });
    await db.insert(schema.gitLink).values({
      id: `git_${randomUUIDv7()}`,
      organizationId: workspace.organizationId,
      issueId,
      kind: 'pull_request',
      externalId: 'pr:noveum/orbit#52:rea-52',
      number: 52,
      repository: 'noveum/orbit',
      title: 'Keep admin pull request access current',
      url: 'https://github.com/noveum/orbit/pull/52',
    });
    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, workspace.adminUser.id),
        ),
      );

    expect(await loadPullRequests(workspace.admin)).toHaveLength(0);
  });
});

describe('refreshPullRequestHistory', () => {
  it('lets only one concurrent request fetch GitHub history', async () => {
    const integrationId = await installation('active');
    const repositoryId = await repository(integrationId);
    const pullRequestId = await mirroredPull(integrationId, repositoryId, 53);
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    let tokenCalls = 0;
    let historyCalls = 0;
    const fetchHistory = ((input: string) => {
      const url = String(input);
      if (url.includes('/access_tokens')) {
        tokenCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ token: 'ghs_history' }), { status: 201 }),
        );
      }
      historyCalls += 1;
      return Promise.resolve(new Response('[]', { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    await Promise.all([
      refreshPullRequestHistory({
        principal: workspace.admin,
        pullRequestId,
        config: {
          slug: 'orbit-test',
          appId: '123',
          privateKey,
          clientId: 'client',
          clientSecret: 'secret',
        },
        fetch: fetchHistory,
      }),
      refreshPullRequestHistory({
        principal: workspace.admin,
        pullRequestId,
        config: {
          slug: 'orbit-test',
          appId: '123',
          privateKey,
          clientId: 'client',
          clientSecret: 'secret',
        },
        fetch: fetchHistory,
      }),
    ]);

    expect(tokenCalls).toBe(1);
    expect(historyCalls).toBe(3);
    const [pull] = await db
      .select({
        historySyncedAt: schema.githubPullRequest.historySyncedAt,
        historyRefreshClaimedAt: schema.githubPullRequest.historyRefreshClaimedAt,
      })
      .from(schema.githubPullRequest)
      .where(eq(schema.githubPullRequest.id, pullRequestId));
    expect(pull?.historySyncedAt).not.toBeNull();
    expect(pull?.historyRefreshClaimedAt).toBeNull();
  });
});
