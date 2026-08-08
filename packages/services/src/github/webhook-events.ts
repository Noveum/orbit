import { githubInstallation } from '@orbit/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { GITHUB_REPOSITORY_SELECTIONS, type GithubInstalledRepository } from './app.ts';
import type { GithubDatabase } from './apply.ts';
import {
  deleteGithubRepositoryEverywhere,
  findGithubInstallationAnywhere,
  purgeGithubInstallation,
  removeGithubRepositories,
  setGithubInstallationStatus,
  updateGithubRepositoryFacts,
  upsertGithubRepositories,
} from './installations.ts';

const GITHUB_INSTALLATION_EVENTS = ['installation', 'installation_repositories', 'repository'];

export function isGithubInstallationEvent(eventName: string): boolean {
  return GITHUB_INSTALLATION_EVENTS.includes(eventName);
}

const shortRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().max(255).default(''),
  full_name: z.string().min(1).max(512),
  private: z.boolean().default(false),
  archived: z.boolean().default(false),
  default_branch: z.string().max(255).default(''),
  html_url: z.string().max(2048).default(''),
  owner: z.object({ login: z.string().max(255).default('') }).nullish(),
});

const installationRefSchema = z.object({
  id: z.number().int().positive(),
  account: z
    .object({
      login: z.string().max(255).default(''),
      id: z.number().int().nonnegative().default(0),
      type: z.string().max(64).default('Organization'),
    })
    .nullish(),
  repository_selection: z.enum(GITHUB_REPOSITORY_SELECTIONS).optional(),
  suspended_at: z.string().nullish(),
});

const installationEventSchema = z.object({
  action: z.string().min(1).max(64),
  installation: installationRefSchema,
  repositories: z.array(shortRepositorySchema).optional(),
});

const installationRepositoriesEventSchema = z.object({
  action: z.string().min(1).max(64),
  installation: installationRefSchema,
  repository_selection: z.enum(GITHUB_REPOSITORY_SELECTIONS).optional(),
  repositories_added: z.array(shortRepositorySchema).default([]),
  repositories_removed: z.array(shortRepositorySchema).default([]),
});

const repositoryEventSchema = z.object({
  action: z.string().min(1).max(64),
  repository: shortRepositorySchema,
  installation: installationRefSchema.optional(),
});

function toInstalledRepository(
  parsed: z.infer<typeof shortRepositorySchema>,
): GithubInstalledRepository {
  const fullName = parsed.full_name;
  const separator = fullName.indexOf('/');
  return {
    repositoryId: String(parsed.id),
    repositoryName: fullName,
    name: parsed.name.length > 0 ? parsed.name : fullName.slice(separator + 1),
    ownerLogin: parsed.owner?.login ?? (separator > 0 ? fullName.slice(0, separator) : ''),
    private: parsed.private,
    archived: parsed.archived,
    defaultBranch: parsed.default_branch.length > 0 ? parsed.default_branch : 'main',
    htmlUrl: parsed.html_url,
  };
}

export interface GithubInstallationApplyResult {
  readonly handled: boolean;
  readonly organizationId: string | null;
}

const IGNORED: GithubInstallationApplyResult = { handled: false, organizationId: null };

export async function applyGithubInstallationEvent(
  database: GithubDatabase,
  input: { readonly eventName: string; readonly body: unknown; readonly now?: Date },
): Promise<GithubInstallationApplyResult> {
  const now = input.now ?? new Date();
  if (input.eventName === 'installation') {
    return await applyInstallation(database, input.body, now);
  }
  if (input.eventName === 'installation_repositories') {
    return await applyInstallationRepositories(database, input.body, now);
  }
  if (input.eventName === 'repository') {
    return await applyRepository(database, input.body, now);
  }
  return IGNORED;
}

async function applyInstallation(
  database: GithubDatabase,
  body: unknown,
  now: Date,
): Promise<GithubInstallationApplyResult> {
  const parsed = installationEventSchema.safeParse(body);
  if (!parsed.success) return IGNORED;
  const installationId = String(parsed.data.installation.id);
  const existing = await findGithubInstallationAnywhere(database, installationId);

  if (parsed.data.action === 'deleted') {
    const removed = await purgeGithubInstallation(database, installationId);
    return { handled: removed, organizationId: existing?.organizationId ?? null };
  }
  if (existing === null) return { handled: false, organizationId: null };

  if (parsed.data.action === 'suspend' || parsed.data.action === 'unsuspend') {
    await setGithubInstallationStatus(database, {
      installationId,
      status: parsed.data.action === 'suspend' ? 'suspended' : 'active',
      now,
    });
    return { handled: true, organizationId: existing.organizationId };
  }

  const selection = parsed.data.installation.repository_selection;
  const suspended = typeof parsed.data.installation.suspended_at === 'string';
  await database
    .update(githubInstallation)
    .set({
      accountLogin: parsed.data.installation.account?.login ?? existing.accountLogin,
      accountId: String(parsed.data.installation.account?.id ?? existing.accountId),
      accountType: parsed.data.installation.account?.type ?? existing.accountType,
      ...(selection === undefined ? {} : { repositorySelection: selection }),
      status: suspended ? 'suspended' : 'active',
      updatedAt: now,
    })
    .where(eq(githubInstallation.id, existing.id));

  if (parsed.data.repositories !== undefined && parsed.data.repositories.length > 0) {
    await upsertGithubRepositories(database, {
      installation: existing,
      repositories: parsed.data.repositories.map(toInstalledRepository),
      now,
    });
  }
  return { handled: true, organizationId: existing.organizationId };
}

async function applyInstallationRepositories(
  database: GithubDatabase,
  body: unknown,
  now: Date,
): Promise<GithubInstallationApplyResult> {
  const parsed = installationRepositoriesEventSchema.safeParse(body);
  if (!parsed.success) return IGNORED;
  const installationId = String(parsed.data.installation.id);
  const existing = await findGithubInstallationAnywhere(database, installationId);
  if (existing === null) return { handled: false, organizationId: null };

  const selection =
    parsed.data.repository_selection ?? parsed.data.installation.repository_selection;
  if (selection !== undefined && selection !== existing.repositorySelection) {
    await database
      .update(githubInstallation)
      .set({ repositorySelection: selection, updatedAt: now })
      .where(eq(githubInstallation.id, existing.id));
  }

  if (parsed.data.repositories_removed.length > 0) {
    await removeGithubRepositories(database, {
      installationId,
      repositoryIds: parsed.data.repositories_removed.map((entry) => String(entry.id)),
    });
  }
  if (parsed.data.repositories_added.length > 0) {
    await upsertGithubRepositories(database, {
      installation: existing,
      repositories: parsed.data.repositories_added.map(toInstalledRepository),
      now,
    });
  }
  return { handled: true, organizationId: existing.organizationId };
}

const REPOSITORY_FACT_ACTIONS = [
  'renamed',
  'transferred',
  'privatized',
  'publicized',
  'archived',
  'unarchived',
  'edited',
];

async function applyRepository(
  database: GithubDatabase,
  body: unknown,
  now: Date,
): Promise<GithubInstallationApplyResult> {
  const parsed = repositoryEventSchema.safeParse(body);
  if (!parsed.success) return IGNORED;
  const repository = toInstalledRepository(parsed.data.repository);

  if (parsed.data.action === 'deleted') {
    const removed = await deleteGithubRepositoryEverywhere(database, repository.repositoryId);
    return { handled: removed > 0, organizationId: null };
  }
  if (!REPOSITORY_FACT_ACTIONS.includes(parsed.data.action)) return IGNORED;

  const updated = await updateGithubRepositoryFacts(database, {
    repositoryId: repository.repositoryId,
    fullName: repository.repositoryName,
    name: repository.name,
    ownerLogin: repository.ownerLogin,
    private: repository.private,
    archived: repository.archived,
    defaultBranch: repository.defaultBranch,
    htmlUrl: repository.htmlUrl,
    now,
  });
  return { handled: updated > 0, organizationId: null };
}
