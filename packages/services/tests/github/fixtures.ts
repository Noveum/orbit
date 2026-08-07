import { organization, project, user } from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import type { GithubInstallationAccount, GithubInstalledRepository } from '../../src/github/app.ts';
import type { TestTransaction } from '../../src/test-database.ts';

export interface TestWorkspace {
  readonly organizationId: string;
  readonly userId: string;
}

export async function seedWorkspace(tx: TestTransaction, name = 'Acme'): Promise<TestWorkspace> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  const userId = `usr_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name, slug: `${name.toLowerCase()}-${suffix.toLowerCase()}` });
  await tx.insert(user).values({
    id: userId,
    name: 'Ada',
    email: `ada.${suffix}@orbit.local`,
    handle: `ada-${suffix.toLowerCase()}`,
  });
  return { organizationId, userId };
}

export async function seedProject(
  tx: TestTransaction,
  workspace: TestWorkspace,
  name: string,
): Promise<string> {
  const id = `prj_${randomUUIDv7()}`;
  await tx.insert(project).values({
    id,
    organizationId: workspace.organizationId,
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${id.slice(-8).toLowerCase()}`,
  });
  return id;
}

export function account(
  overrides: Partial<GithubInstallationAccount> & { readonly installationId: string },
): GithubInstallationAccount {
  return {
    accountLogin: 'Noveum',
    accountId: '192082188',
    accountType: 'Organization',
    repositorySelection: 'all',
    suspended: false,
    ...overrides,
  };
}

export function repository(
  overrides: Partial<GithubInstalledRepository> & { readonly repositoryId: string },
): GithubInstalledRepository {
  const fullName = overrides.repositoryName ?? `Noveum/repo-${overrides.repositoryId}`;
  return {
    repositoryName: fullName,
    name: fullName.slice(fullName.indexOf('/') + 1),
    ownerLogin: fullName.slice(0, fullName.indexOf('/')),
    private: false,
    archived: false,
    defaultBranch: 'main',
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}
