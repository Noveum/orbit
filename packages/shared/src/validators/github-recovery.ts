import { z } from 'zod';
import { idSchema } from './common.ts';

const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/i)
  .toLowerCase();
const providerIdSchema = z.number().int().positive();

export const githubRecoveryRequestSchema = z.strictObject({
  reconciliationId: idSchema,
  pullRequestId: idSchema,
  expectedJobVersion: z.number().int().positive(),
  expectedContextGeneration: z.number().int().nonnegative(),
  expectedHeadEpoch: z.number().int().nonnegative(),
  expectedHeadSha: commitShaSchema,
});
export type GithubRecoveryRequest = z.infer<typeof githubRecoveryRequestSchema>;

export const githubRecoveryCandidateSchema = z.strictObject({
  repositoryName: z.string(),
  pullRequestNumber: z.number().int().positive(),
  selector: githubRecoveryRequestSchema,
});
export type GithubRecoveryCandidate = z.infer<typeof githubRecoveryCandidateSchema>;

export const githubRecoveryCursorSchema = z.strictObject({
  workspace: idSchema,
  after: idSchema,
});
export type GithubRecoveryCursor = z.infer<typeof githubRecoveryCursorSchema>;
export const githubRecoveryQuerySchema = z.union([
  githubRecoveryCursorSchema,
  z.strictObject({}).transform(() => null),
]);
export const githubRecoveryPageSchema = z.strictObject({
  workspace: idSchema,
  candidates: githubRecoveryCandidateSchema.array().max(20),
  nextCursor: githubRecoveryCursorSchema.nullable(),
});
export type GithubRecoveryPage = z.infer<typeof githubRecoveryPageSchema>;

export const githubRecoveryResultSchema = z.strictObject({
  status: z.enum([
    'queued',
    'already_queued',
    'already_attempted',
    'busy',
    'superseded',
    'not_active',
    'head_changed',
    'installation_unavailable',
    'installation_suspended',
    'repository_unavailable',
    'pull_request_unavailable',
    'repository_access_required',
    'provider_authentication_failed',
    'provider_temporarily_unavailable',
    'expired',
  ]),
});
export type GithubRecoveryResult = z.infer<typeof githubRecoveryResultSchema>;
export type GithubRecoveryStatus = GithubRecoveryResult['status'];

export const githubRecoveryInstallationSchema = z.object({
  id: providerIdSchema,
  app_id: providerIdSchema,
  account: z.object({ id: providerIdSchema }),
  suspended_at: z.string().min(1).max(128).nullable(),
});

const repositoryNameSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/)
  .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'));

export const githubRecoveryRepositoriesSchema = z.object({
  total_count: z.literal(1),
  repositories: z.tuple([
    z.object({
      id: providerIdSchema,
      full_name: repositoryNameSchema,
    }),
  ]),
});

export const githubRecoveryPullRequestSchema = z
  .object({
    id: providerIdSchema,
    number: z.number().int().positive(),
    state: z.enum(['open', 'closed']),
    merged: z.boolean(),
    draft: z.boolean(),
    head: z.object({ sha: commitShaSchema }),
    base: z.object({ repo: z.object({ id: providerIdSchema }) }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .refine((value) => !value.merged || value.state === 'closed');

export const githubRecoveryTokenSchema = z.object({ token: z.string().min(1) });
