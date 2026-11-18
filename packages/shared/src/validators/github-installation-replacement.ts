import { z } from 'zod';

const GITHUB_MAX_REPOSITORY_PAGES = 100;
const GITHUB_REPOSITORY_PAGE_SIZE = 100;

const githubReplacementIdSchema = z
  .string()
  .max(16)
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
const githubReplacementProviderIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const githubReplacementAccountTypeSchema = z.enum(['User', 'Organization']);
export const githubReplacementRequestSchema = z.object({
  appId: githubReplacementIdSchema,
  privateKey: z.string().min(1).max(32_768),
  installationId: githubReplacementIdSchema,
});
export const githubReplacementInputSchema = githubReplacementRequestSchema
  .extend({
    previousInstallationId: githubReplacementIdSchema,
    expectedAccountId: githubReplacementIdSchema,
    expectedAccountType: githubReplacementAccountTypeSchema,
    watchedRepositoryIds: z
      .array(githubReplacementIdSchema)
      .max(GITHUB_MAX_REPOSITORY_PAGES * GITHUB_REPOSITORY_PAGE_SIZE)
      .refine((values) => new Set(values).size === values.length),
  })
  .refine((value) => value.previousInstallationId !== value.installationId);
export const githubReplacementInstallationSchema = z.object({
  id: githubReplacementProviderIdSchema,
  app_id: githubReplacementProviderIdSchema,
  account: z.object({
    id: githubReplacementProviderIdSchema,
    login: z.string().min(1).max(255),
    type: githubReplacementAccountTypeSchema,
  }),
  repository_selection: z.enum(['all', 'selected']),
  suspended_at: z.string().min(1).nullable(),
});
const githubReplacementRepositorySchema = z.object({
  id: githubReplacementProviderIdSchema,
  full_name: z.string().min(1).max(512),
  name: z.string().max(255).default(''),
  owner: z.object({ login: z.string().max(255) }).nullish(),
  private: z.boolean().default(false),
  archived: z.boolean().default(false),
  default_branch: z.string().min(1).max(255).default('main'),
  html_url: z.string().max(2048).default(''),
});
export const githubReplacementCatalogueSchema = z.object({
  total_count: z
    .number()
    .int()
    .nonnegative()
    .max(GITHUB_MAX_REPOSITORY_PAGES * GITHUB_REPOSITORY_PAGE_SIZE),
  repositories: z.array(githubReplacementRepositorySchema).max(GITHUB_REPOSITORY_PAGE_SIZE),
});
export const githubReplacementTokenSchema = z.object({ token: z.string().min(1).max(8192) });

export type GithubReplacementRepositoryMetadata = z.infer<typeof githubReplacementRepositorySchema>;
