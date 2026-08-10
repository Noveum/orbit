import { z } from 'zod';

const fullCommit = z.string().regex(/^[a-f0-9]{40}$/);

export const githubWorkflowAttemptSchema = z
  .object({
    workflow_id: z.number().int().positive(),
    head_sha: fullCommit,
    conclusion: z.string().nullable(),
    run_attempt: z.number().int().positive(),
    event: z.string().max(64),
    path: z.string().max(1_024),
    run_started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    repository: z.object({ full_name: z.string().max(256) }).passthrough(),
    pull_requests: z.array(
      z
        .object({
          number: z.number().int().positive(),
          head: z
            .object({
              sha: fullCommit,
            })
            .passthrough(),
          base: z
            .object({
              ref: z.string().max(256),
              sha: fullCommit,
              repo: z
                .object({ full_name: z.string().max(256) })
                .passthrough()
                .nullable()
                .optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const githubContentFileSchema = z
  .object({
    type: z.literal('file'),
    encoding: z.literal('base64'),
    content: z.string().max(2_000_000),
    size: z.number().int().nonnegative().max(1_000_000),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .passthrough();

export const githubWorkflowJobsSchema = z
  .object({
    total_count: z.number().int().nonnegative(),
    jobs: z.array(
      z
        .object({
          name: z.string().max(256),
          conclusion: z.string().nullable(),
          head_sha: fullCommit,
          steps: z.array(
            z
              .object({
                name: z.string().max(256),
                conclusion: z.string().nullable(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const githubActionsArtifactsSchema = z
  .object({
    total_count: z.number().int().nonnegative(),
    artifacts: z.array(
      z
        .object({
          name: z.string().max(256),
          digest: z.string().nullable().optional(),
          expired: z.boolean(),
          created_at: z.string().datetime(),
          workflow_run: z
            .object({
              head_sha: fullCommit,
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const readinessFindingId = z.string().regex(/^[A-Z][A-Z0-9]*-\d{3}$/);

export const readinessScopeManifestSchema = z
  .object({
    version: z.string().regex(/^readiness-scope\/\d{4}-\d{2}-\d{2}-v[1-9]\d*$/),
    digest: sha256Digest,
    findings: z
      .array(
        z
          .object({
            id: readinessFindingId,
            priority: z.enum(['P0', 'P1']),
            findingHash: sha256Digest,
            requiredOutcomeHash: sha256Digest,
          })
          .strict(),
      )
      .min(1)
      .max(256),
  })
  .strict();

export const readinessScopeAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('scope-change'),
    baseVersion: z.string().max(128),
    headVersion: z.string().max(128),
    baseDigest: sha256Digest,
    headDigest: sha256Digest,
    reviewUrl: z.string().url().max(512),
    changedFindingIds: z.array(readinessFindingId).min(1).max(256),
    noRiskDisappears: z.literal(true),
    rationale: z.string().max(2_000),
  })
  .strict();

export const readinessReferenceRegistrySourceSchema = z
  .object({
    recordEntries: z.array(z.tuple([z.string().max(256), z.unknown()])).max(2_048),
    principalEntries: z.array(z.tuple([z.string().max(256), z.unknown()])).max(2_048),
  })
  .strict();

const scopeArtifactsSchema = z
  .object({
    plan: z.string().max(1_000_000),
    ledger: z.string().max(1_000_000),
    manifest: z.string().max(256_000),
    audit: z.string().max(256_000),
    registry: z.string().max(1_000_000),
  })
  .strict();

const MAX_SCOPE_ARTIFACT_BYTES = 3_000_000;

function artifactByteLength(value: typeof scopeArtifactsSchema._output): number {
  const encoder = new TextEncoder();
  return Object.values(value).reduce(
    (total, artifact) => total + encoder.encode(artifact).length,
    0,
  );
}

const readyEvidenceSchema = z
  .object({
    findingId: readinessFindingId,
    evidenceCommit: fullCommit,
    baseContainsEvidence: z.boolean(),
    pullRequestNumber: z.number().int().positive(),
    pullRequestBaseRef: z.string().max(256),
    pullRequestBaseSha: fullCommit,
    pullRequestBaseRepository: z.string().max(256),
    pullRequestHeadSha: fullCommit,
    mergeCommitSha: fullCommit,
    mergedAt: z.string().datetime(),
    statusState: z.enum(['error', 'failure', 'pending', 'success']),
    statusContext: z.string().max(256),
    statusCreator: z.string().max(128),
    statusTargetUrl: z
      .string()
      .regex(/^https:\/\/github\.com\/Noveum\/orbit\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/),
    statusCreatedAt: z.string().datetime(),
    statusUpdatedAt: z.string().datetime(),
    configuredWorkflowId: z.number().int().positive(),
    runWorkflowId: z.number().int().positive(),
    runWorkflowPath: z.string().max(1_024),
    runWorkflowState: z.literal('active'),
    runWorkflowDefinitionDigest: sha256Digest,
    runRepository: z.string().max(256),
    runId: z.number().int().positive(),
    runAttempt: z.number().int().positive(),
    runEvent: z.string().max(64),
    runConclusion: z.string().nullable(),
    runHeadSha: fullCommit,
    definitionCommitSha: fullCommit,
    definitionCommitIsEvidenceAncestor: z.boolean(),
    runStartedAt: z.string().datetime(),
    runUpdatedAt: z.string().datetime(),
    runPullRequests: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            headSha: fullCommit,
            baseRef: z.string().max(256),
            baseSha: fullCommit,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const readinessScopePrInputSchema = z
  .object({
    baseRef: z.literal('main'),
    baseSha: fullCommit,
    headSha: fullCommit,
    changedFiles: z.array(z.string().max(1_024)).max(256),
    base: scopeArtifactsSchema,
    head: scopeArtifactsSchema,
    readyEvidence: z.array(readyEvidenceSchema).max(256),
    reviews: z
      .array(
        z
          .object({
            login: z.string().max(128),
            state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED']),
            commitId: fullCommit,
            submittedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (artifactByteLength(value.base) + artifactByteLength(value.head) > MAX_SCOPE_ARTIFACT_BYTES)
      context.addIssue({ code: 'custom', message: 'Readiness scope artifacts exceed the limit.' });
  });

export const pullRequestTargetEventSchema = z
  .object({
    pull_request: z.object({
      number: z.number().int().positive(),
      base: z.object({ ref: z.literal('main'), sha: fullCommit }).passthrough(),
      head: z.object({ sha: fullCommit }).passthrough(),
    }),
  })
  .passthrough();

export const githubReviewResponseSchema = z.array(
  z
    .object({
      user: z.object({ login: z.string().max(128) }).nullable(),
      state: z.string().max(64),
      commit_id: fullCommit,
      submitted_at: z.string().datetime().nullable(),
    })
    .passthrough(),
);

export const githubPullResponseSchema = z
  .object({
    base: z.object({ sha: fullCommit }).passthrough(),
    head: z.object({ sha: fullCommit }).passthrough(),
  })
  .passthrough();

export const githubAssociatedPullsResponseSchema = z
  .array(
    z
      .object({
        number: z.number().int().positive(),
        merged_at: z.string().datetime().nullable(),
        merge_commit_sha: fullCommit.nullable(),
        head: z.object({ sha: fullCommit }).passthrough(),
        base: z
          .object({
            ref: z.string().max(256),
            sha: fullCommit,
            repo: z.object({ full_name: z.string().max(256) }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  )
  .max(100);

export const githubCommitStatusesResponseSchema = z
  .array(
    z
      .object({
        state: z.enum(['error', 'failure', 'pending', 'success']),
        context: z.string().max(256),
        target_url: z.string().url().max(1_024).nullable(),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        creator: z.object({ login: z.string().max(128) }).nullable(),
      })
      .passthrough(),
  )
  .max(100);

export const githubWorkflowIdentitySchema = z
  .object({
    id: z.number().int().positive(),
    path: z.string().max(1_024),
    state: z.literal('active'),
  })
  .passthrough();

export const githubEvidencePullResponseSchema = z
  .object({
    number: z.number().int().positive(),
    merged_at: z.string().datetime().nullable(),
    merge_commit_sha: fullCommit.nullable(),
    head: z.object({ sha: fullCommit }).passthrough(),
  })
  .passthrough();
