import { z } from 'zod';

const boundedString = (maximum: number) => z.string().trim().min(1).max(maximum);
const positiveIntegerSchema = z.number().int().positive();
const githubPullRequestNumberSchema = positiveIntegerSchema.max(2_147_483_647);
const nonnegativeCursorSchema = z.number().finite().int().nonnegative().nullable();
const nonnegativeIntegerSchema = z.number().finite().int().nonnegative();
const githubWorkflowConclusionSchema = z
  .enum([
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
    'startup_failure',
    'stale',
  ])
  .nullable();
const githubWorkflowRunStatusSchema = z.enum([
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'requested',
  'pending',
]);
const vercelMetadataValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const vercelDeploymentIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const vercelTargetSchema = z.enum(['production', 'staging']).nullable();
const vercelReadyStateSchema = z.enum([
  'QUEUED',
  'INITIALIZING',
  'BUILDING',
  'READY',
  'ERROR',
  'CANCELED',
  'BLOCKED',
  'DELETED',
]);

export const gitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const githubPreviewRepositorySchema = z
  .object({
    id: positiveIntegerSchema,
    name: boundedString(100),
    owner: z.object({ login: boundedString(100) }),
  })
  .passthrough();
export type GithubPreviewRepository = z.infer<typeof githubPreviewRepositorySchema>;

export const githubPreviewPullRequestSchema = z.object({
  number: positiveIntegerSchema,
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  labels: z.array(z.object({ name: boundedString(100) })).max(100),
  head: z.object({
    sha: gitShaSchema,
    ref: boundedString(255),
    repo: githubPreviewRepositorySchema,
  }),
  base: z.object({
    ref: boundedString(255),
    repo: githubPreviewRepositorySchema,
  }),
});
export type GithubPreviewPullRequest = z.infer<typeof githubPreviewPullRequestSchema>;

export const githubPreviewRefSchema = z
  .object({ object: z.object({ sha: gitShaSchema }).passthrough() })
  .passthrough();
export type GithubPreviewRef = z.infer<typeof githubPreviewRefSchema>;

export const githubPreviewWorkflowSchema = z
  .object({
    id: positiveIntegerSchema,
    name: boundedString(255),
    path: z
      .string()
      .regex(/^\.github\/workflows\/.+\.ya?ml$/)
      .max(1024),
    state: z.enum([
      'active',
      'deleted',
      'disabled_fork',
      'disabled_inactivity',
      'disabled_manually',
    ]),
  })
  .passthrough();
export type GithubPreviewWorkflow = z.infer<typeof githubPreviewWorkflowSchema>;

export const githubPreviewPullRequestTargetEventSchema = z
  .object({
    action: z.enum([
      'opened',
      'reopened',
      'synchronize',
      'ready_for_review',
      'converted_to_draft',
      'labeled',
      'unlabeled',
      'closed',
    ]),
    number: positiveIntegerSchema,
    pull_request: githubPreviewPullRequestSchema,
    repository: githubPreviewRepositorySchema,
  })
  .passthrough();
export type GithubPreviewPullRequestTargetEvent = z.infer<
  typeof githubPreviewPullRequestTargetEventSchema
>;

export const githubPreviewRepositoryDispatchEventSchema = z
  .object({
    action: z.literal('vercel-preview-reconcile'),
    client_payload: z.object({ pull_request: githubPullRequestNumberSchema }),
    repository: githubPreviewRepositorySchema,
  })
  .passthrough();
export type GithubPreviewRepositoryDispatchEvent = z.infer<
  typeof githubPreviewRepositoryDispatchEventSchema
>;

export const githubPreviewWorkflowLinkedRepositorySchema = z
  .object({
    id: positiveIntegerSchema,
    name: boundedString(100),
  })
  .passthrough();
export type GithubPreviewWorkflowLinkedRepository = z.infer<
  typeof githubPreviewWorkflowLinkedRepositorySchema
>;

const githubPreviewWorkflowPullRequestSchema = z
  .object({
    number: positiveIntegerSchema,
    head: z.object({
      sha: gitShaSchema,
      ref: boundedString(255),
      repo: githubPreviewWorkflowLinkedRepositorySchema,
    }),
    base: z.object({
      sha: gitShaSchema,
      ref: boundedString(255),
      repo: githubPreviewWorkflowLinkedRepositorySchema,
    }),
  })
  .passthrough();

const githubPreviewWorkflowRunSchema = z
  .object({
    id: positiveIntegerSchema,
    workflow_id: positiveIntegerSchema,
    name: boundedString(255),
    event: boundedString(100),
    head_sha: gitShaSchema,
    status: githubWorkflowRunStatusSchema,
    conclusion: githubWorkflowConclusionSchema,
    created_at: z.iso.datetime({ offset: true }),
    pull_requests: z.array(githubPreviewWorkflowPullRequestSchema).max(100),
  })
  .passthrough();
export type GithubPreviewWorkflowRun = z.infer<typeof githubPreviewWorkflowRunSchema>;

export const githubPreviewWorkflowRunEventSchema = z
  .object({
    action: z.enum(['completed', 'requested', 'in_progress']),
    repository: githubPreviewRepositorySchema,
    workflow_run: githubPreviewWorkflowRunSchema,
  })
  .passthrough();
export type GithubPreviewWorkflowRunEvent = z.infer<typeof githubPreviewWorkflowRunEventSchema>;

const githubPreviewNonRenameStatusSchema = z.enum([
  'added',
  'removed',
  'modified',
  'copied',
  'changed',
  'unchanged',
]);

export const githubPreviewFileSchema = z.discriminatedUnion('status', [
  z
    .object({
      filename: boundedString(1024),
      status: z.literal('renamed'),
      previous_filename: boundedString(1024),
    })
    .passthrough(),
  z
    .object({
      filename: boundedString(1024),
      status: githubPreviewNonRenameStatusSchema,
      previous_filename: boundedString(1024).optional(),
    })
    .passthrough(),
]);
export type GithubPreviewFile = z.infer<typeof githubPreviewFileSchema>;

export const githubPreviewFilesSchema = z.array(githubPreviewFileSchema).max(100);
export type GithubPreviewFiles = z.infer<typeof githubPreviewFilesSchema>;

export const githubPreviewWorkflowRunsSchema = z
  .object({
    total_count: nonnegativeIntegerSchema,
    workflow_runs: z.array(githubPreviewWorkflowRunSchema).max(100),
  })
  .passthrough();
export type GithubPreviewWorkflowRuns = z.infer<typeof githubPreviewWorkflowRunsSchema>;

export const vercelDeploymentSchema = z
  .object({
    uid: vercelDeploymentIdSchema,
    projectId: boundedString(255),
    url: boundedString(255).nullable(),
    target: vercelTargetSchema.optional(),
    readyState: vercelReadyStateSchema,
    meta: z.record(z.string(), vercelMetadataValueSchema).optional().default({}),
  })
  .passthrough();
export type VercelDeployment = z.infer<typeof vercelDeploymentSchema>;

export const vercelDeploymentsPageSchema = z
  .object({
    deployments: z.array(vercelDeploymentSchema).max(100),
    pagination: z.object({
      count: nonnegativeIntegerSchema,
      next: nonnegativeCursorSchema,
      prev: nonnegativeCursorSchema,
    }),
  })
  .passthrough();
export type VercelDeploymentsPage = z.infer<typeof vercelDeploymentsPageSchema>;

export const vercelProjectSchema = z
  .object({
    id: boundedString(255),
    name: boundedString(100),
    accountId: boundedString(255),
  })
  .passthrough();
export type VercelProject = z.infer<typeof vercelProjectSchema>;

const vercelDeploymentMutationSchema = z
  .object({
    id: vercelDeploymentIdSchema,
    projectId: boundedString(255),
    url: boundedString(255),
    target: vercelTargetSchema,
    readyState: vercelReadyStateSchema,
    meta: z.record(z.string(), vercelMetadataValueSchema),
  })
  .passthrough();

export const vercelCreatedDeploymentSchema = vercelDeploymentMutationSchema;
export type VercelCreatedDeployment = z.infer<typeof vercelCreatedDeploymentSchema>;

export const vercelDeploymentDetailSchema = vercelDeploymentMutationSchema;
export type VercelDeploymentDetail = z.infer<typeof vercelDeploymentDetailSchema>;

export const vercelCanceledDeploymentSchema = vercelDeploymentMutationSchema;
export type VercelCanceledDeployment = z.infer<typeof vercelCanceledDeploymentSchema>;

export const vercelPreviewEnvironmentSchema = z.object({
  GITHUB_EVENT_NAME: z.enum(['pull_request_target', 'workflow_run', 'repository_dispatch']),
  GITHUB_EVENT_PATH: boundedString(4096),
  GITHUB_REPOSITORY: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .max(255),
  GITHUB_TOKEN: boundedString(2048),
  VERCEL_TOKEN: boundedString(2048),
  VERCEL_TEAM_ID: boundedString(255),
  VERCEL_PROJECT_ID: boundedString(255),
  VERCEL_PROJECT_NAME: boundedString(100),
});
export type VercelPreviewEnvironment = z.infer<typeof vercelPreviewEnvironmentSchema>;
