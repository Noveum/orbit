import { z } from 'zod';

const fullCommit = z.string().regex(/^[a-f0-9]{40}$/);

export const githubWorkflowAttemptSchema = z
  .object({
    head_sha: fullCommit,
    conclusion: z.string().nullable(),
    run_attempt: z.number().int().positive(),
    event: z.string().max(64),
    path: z.string().max(1_024),
    run_started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    pull_requests: z.array(
      z
        .object({
          number: z.number().int().positive(),
        })
        .passthrough(),
    ),
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

export const readinessScopePrInputSchema = z
  .object({
    baseSha: fullCommit,
    headSha: fullCommit,
    changedFiles: z.array(z.string().max(1_024)).max(256),
    base: scopeArtifactsSchema,
    head: scopeArtifactsSchema,
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
  .strict();

export const pullRequestTargetEventSchema = z
  .object({
    number: z.number().int().positive(),
    pull_request: z.object({
      base: z.object({ sha: fullCommit }).passthrough(),
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

export const githubEvidencePullResponseSchema = z
  .object({
    number: z.number().int().positive(),
    merged_at: z.string().datetime().nullable(),
    merge_commit_sha: fullCommit.nullable(),
    head: z.object({ sha: fullCommit }).passthrough(),
  })
  .passthrough();
