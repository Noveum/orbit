import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  addMember,
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
} from '../../src/test-helpers.ts';

type TestClient = Awaited<ReturnType<typeof connect>>;
type TestWorkspace = Awaited<ReturnType<typeof createWorkspace>>;

let workspace: TestWorkspace;
let admin: TestClient;
let guest: TestClient;
let projectId: string;
let otherProjectId: string;

const REPOSITORY = 'Noveum/orbit';
const SECOND_REPOSITORY = 'Noveum/api-market';

interface RepositoryRow {
  readonly fullName: string;
  readonly projectIds: readonly string[];
  readonly workspaceWide: boolean;
  readonly associated: boolean;
}

function repositoriesOf(payload: Record<string, unknown>): RepositoryRow[] {
  return payload['repositories'] as RepositoryRow[];
}

function entry(payload: Record<string, unknown>, fullName: string): RepositoryRow | undefined {
  return repositoriesOf(payload).find((row) => row.fullName === fullName);
}

async function installRepository(fullName: string, externalId: string): Promise<void> {
  const integrationId = randomUUIDv7();
  const installationRowId = randomUUIDv7();
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId: workspace.organizationId,
    provider: 'github',
    externalId: externalId,
    connectedById: workspace.adminUser.id,
  });
  await db.insert(schema.githubInstallation).values({
    id: installationRowId,
    organizationId: workspace.organizationId,
    integrationId,
    installationId: externalId,
    accountLogin: 'Noveum',
    connectedById: workspace.adminUser.id,
  });
  await db.insert(schema.githubRepository).values({
    id: randomUUIDv7(),
    organizationId: workspace.organizationId,
    installationRowId,
    repositoryId: externalId,
    fullName,
    name: fullName.split('/')[1] ?? fullName,
    ownerLogin: 'Noveum',
  });
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));

  const created = await admin.result('create_project', { name: 'Platform' });
  projectId = (created['project'] as { id: string }).id;
  const second = await admin.result('create_project', { name: 'Marketplace' });
  otherProjectId = (second['project'] as { id: string }).id;

  await installRepository(REPOSITORY, '900001');
  await installRepository(SECOND_REPOSITORY, '900002');
});

afterAll(async () => {
  await admin.close();
  await guest.close();
});

describe('seeing what GitHub is connected', () => {
  it('lists every installed repository, associated or not', async () => {
    const listed = await admin.result('list_github_repositories');

    expect(entry(listed, REPOSITORY)?.associated).toBe(false);
    expect(entry(listed, SECOND_REPOSITORY)).toBeDefined();
  });

  it('refuses a member who may not manage integrations', async () => {
    const failure = await guest.call('list_github_repositories');

    expect(errorPayload(failure).code).toBe('forbidden');
  });
});

describe('associating a repository with projects', () => {
  it('gives one project more than one repository', async () => {
    await admin.result('link_github_repository', { repository: REPOSITORY, project: 'Platform' });
    await admin.result('link_github_repository', {
      repository: SECOND_REPOSITORY,
      project: 'Platform',
    });

    const listed = await admin.result('list_github_repositories');

    expect(entry(listed, REPOSITORY)?.projectIds).toEqual([projectId]);
    expect(entry(listed, SECOND_REPOSITORY)?.projectIds).toEqual([projectId]);
  });

  it('gives one repository more than one project', async () => {
    await admin.result('link_github_repository', {
      repository: REPOSITORY,
      project: 'Marketplace',
    });

    const listed = await admin.result('list_github_repositories');
    const found = entry(listed, REPOSITORY);

    expect(found?.projectIds).toHaveLength(2);
    expect(found?.projectIds).toContain(projectId);
    expect(found?.projectIds).toContain(otherProjectId);
  });

  it('associates with the whole workspace when no project is named', async () => {
    await admin.result('link_github_repository', { repository: SECOND_REPOSITORY });

    const listed = await admin.result('list_github_repositories');

    expect(entry(listed, SECOND_REPOSITORY)?.workspaceWide).toBe(true);
  });

  it('starts watching the repository, which is what lets its events through', async () => {
    const watched = await db
      .select()
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.repositoryId, '900001'));

    expect(watched).toHaveLength(1);
    expect(watched[0]?.enabled).toBe(true);
  });

  it('says so rather than guessing when the repository is not connected', async () => {
    const failure = await admin.call('link_github_repository', {
      repository: 'Noveum/not-installed',
      project: 'Platform',
    });

    expect(errorPayload(failure).code).toBe('not_found');
  });

  it('refuses a member who may not manage integrations', async () => {
    const failure = await guest.call('link_github_repository', {
      repository: REPOSITORY,
      project: 'Platform',
    });

    expect(errorPayload(failure).code).toBe('forbidden');
  });
});

describe('removing an association', () => {
  it('drops only the project asked for, leaving the other', async () => {
    await admin.result('unlink_github_repository', {
      repository: REPOSITORY,
      project: 'Marketplace',
    });

    const listed = await admin.result('list_github_repositories');

    expect(entry(listed, REPOSITORY)?.projectIds).toEqual([projectId]);
  });
});

describe('reading the pull requests on an issue', () => {
  it('shows them to somebody who may read the issue but not manage integrations', async () => {
    const created = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Wire the socket',
    });
    const issue = created['issue'] as { id: string; identifier: string };

    await db.insert(schema.gitLink).values({
      id: randomUUIDv7(),
      organizationId: workspace.organizationId,
      issueId: issue.id,
      kind: 'pull_request',
      externalId: 'pr-1',
      number: 7,
      repository: REPOSITORY,
      branch: 'shashank/eng-1-wire-the-socket',
      title: 'Wire the socket',
      url: 'https://github.com/Noveum/orbit/pull/7',
      state: 'open',
    });

    const listed = await guest.result('list_issue_pull_requests', { issue: issue.identifier });
    const links = listed['links'] as { url: string; branch: string }[];

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe('https://github.com/Noveum/orbit/pull/7');
  });

  it('returns nothing for an issue with no pull request', async () => {
    const created = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Nothing linked here',
    });
    const issue = created['issue'] as { identifier: string };

    const listed = await admin.result('list_issue_pull_requests', { issue: issue.identifier });

    expect(listed['links']).toHaveLength(0);
  });
});
