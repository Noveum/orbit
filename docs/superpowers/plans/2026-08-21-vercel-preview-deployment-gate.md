# Vercel Preview Deployment Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the token-bearing Vercel Ignored Build Step with a trusted, CI-green GitHub dispatcher that creates only eligible same-repository Preview deployments.

**Architecture:** Vercel keeps automatic production deployment for `main` and disables automatic feature-branch deployment with a minimatch branch map. A default-branch GitHub workflow reconciles pull request state after CI success or an eligibility transition, and a trusted Bun controller validates GitHub and Vercel data with shared Zod schemas before creating or canceling exact Preview deployments.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9, Zod 4, GitHub Actions, GitHub REST API, Vercel REST API, Bun test.

**Spec:** `docs/superpowers/specs/2026-08-21-vercel-preview-deployment-gate-design.md`

## Global Constraints

- Use Bun only. No npm, pnpm, yarn, turbo.
- Shipped server code must not import Bun built-ins.
- No code comments except functional directives accepted by `bun run check-comments`.
- No em-dash characters in code, docs, commits, branch names, or pull request text.
- No AI attribution anywhere.
- Strict types: no `any`, no non-null assertions, and every external payload is parsed with a Zod schema exported from `@orbit/shared/validators`.
- Tests import from `bun:test`. Shared validator tests mirror `packages/shared/src/validators`; repository scripts use the existing `scripts/*.test.ts` convention.
- No new runtime or development dependency is added.
- The trusted workflow never checks out, fetches, installs, builds, caches, or executes pull request code and never downloads an untrusted artifact.
- Automatic token-backed deployment is limited to open pull requests whose head repository ID equals the base repository ID.
- A Preview requires successful `CI` for the exact current head SHA; `no-preview` wins over `preview`; active ineligible builds are canceled.
- Web-impacting paths are `apps/web/**`, `packages/**`, `package.json`, `bun.lock`, and `tsconfig.base.json`. For a rename, either the current filename or validated `previous_filename` can match.
- Vercel branch suppression uses `"**": false`, not `"*": false`, because unspecified slash-containing branches default to enabled.
- Git Fork Protection stays enabled. Fork Preview automation is out of scope.
- Branch: `chore/gate-preview-builds`. Merge current `origin/main` before implementation and retain both the root script-test command and main's dependency overrides.

---

## File structure map

- Create `packages/shared/src/validators/vercel-preview.ts`: schemas and inferred types for GitHub events, GitHub pull request/files/workflow responses, Vercel deployment pages and mutations, and controller environment.
- Modify `packages/shared/src/validators/index.ts`: export the new validator module.
- Create `packages/shared/tests/validators/vercel-preview.test.ts`: accepted and rejected external payload shapes.
- Create `scripts/vercel-preview-policy.ts`: pure eligibility, repository, path, state, and deployment-matching rules.
- Create `scripts/vercel-preview-policy.test.ts`: policy truth tables, label precedence, slash-path coverage, and deployment identity.
- Create `scripts/vercel-preview-deploy.ts`: event resolution, bounded HTTP client, GitHub reconciliation, Vercel creation/cancellation, and CLI entry point.
- Create `scripts/vercel-preview-deploy.test.ts`: injected-fetch orchestration tests with no real network calls.
- Create `scripts/vercel-preview-config.test.ts`: repository configuration, managed labels, workflow trust invariants, and removal of the old token gate.
- Create `.github/workflows/vercel-preview.yml`: default-branch metadata-only dispatcher.
- Modify `.github/workflows/ci.yml`: make hosted CI include the two repository verification checks currently omitted from its static job.
- Modify `apps/web/vercel.json`: remove `ignoreCommand`; disable automatic feature branches and retain `main`.
- Modify `scripts/labels.ts`: manage `preview` and `no-preview`.
- Delete `scripts/vercel-build-gate.sh` and `scripts/vercel-build-gate.test.ts`.
- Rewrite `docs/VERCEL_BUILD_GATE.md`: CI-green behavior, setup, security, billing scope, transitions, and canary procedure.
- Modify `docs/README.md`: link the deployment gate guide.
- Modify the pull request body after push: describe the final architecture and tests, remove stale counts and prohibited attribution.

---

### Task 1: Shared schemas and pure Preview policy

**Files:**
- Create: `packages/shared/src/validators/vercel-preview.ts`
- Modify: `packages/shared/src/validators/index.ts`
- Test: `packages/shared/tests/validators/vercel-preview.test.ts`
- Create: `scripts/vercel-preview-policy.ts`
- Test: `scripts/vercel-preview-policy.test.ts`

**Interfaces:**
- Produces `githubPreviewPullRequestSchema`, `githubPreviewPullRequestTargetEventSchema`, `githubPreviewWorkflowRunEventSchema`, `githubPreviewRepositoryDispatchEventSchema`, `githubPreviewFilesSchema`, `githubPreviewWorkflowSchema`, `githubPreviewWorkflowRunsSchema`, `githubPreviewRefSchema`, `vercelDeploymentSchema`, `vercelDeploymentsPageSchema`, `vercelCreatedDeploymentSchema`, `vercelDeploymentDetailSchema`, `vercelCanceledDeploymentSchema`, and `vercelPreviewEnvironmentSchema`.
- Produces inferred `GithubPreviewPullRequest`, `GithubPreviewFile`, `VercelDeployment`, and `VercelPreviewEnvironment` types.
- Produces `PREVIEW_LABEL`, `NO_PREVIEW_LABEL`, `isPreviewEligible`, `isSameRepositoryPullRequest`, `isWebPreviewFile`, `isActiveVercelDeployment`, `isReadyVercelDeployment`, and `matchesVercelPullRequest`.
- The controller in Task 2 consumes every interface above and does not define a second copy of validation or policy.

- [x] **Step 1: Write failing validator tests**

Create fixtures with a 40-character lowercase SHA and assert the schemas accept a complete open pull request, state event including `closed`, successful CI workflow event, repository-dispatch recovery input, GitHub file page, canonical workflow response, workflow-run page with `total_count`, live Git ref response, Vercel deployment page with `pagination.count`, create response, detail response, cancel response, and complete environment. Add rejection cases for a short SHA, missing repository ID, missing draft state, unknown Vercel ready state, nonnumeric recovery input, invalid pagination, and missing secrets. Workflow-run linked pull requests use GitHub's minimal repository shape with ID and name rather than the full repository shape with `owner.login`. Vercel list items require `projectId` but accept missing metadata as an empty record; mutation and detail responses require `id`, `projectId`, a nonempty URL, target, state, and metadata.

```ts
expect(githubPreviewPullRequestSchema.parse(pullRequest).head.sha).toBe(SHA);
expect(() =>
  githubPreviewPullRequestSchema.parse({
    ...pullRequest,
    head: { ...pullRequest.head, sha: 'short' },
  }),
).toThrow();
expect(() =>
  vercelPreviewEnvironmentSchema.parse({
    GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_EVENT_PATH: '/tmp/event.json',
  }),
).toThrow();
```

- [x] **Step 2: Run the validator test and confirm failure**

Run: `bun test packages/shared/tests/validators/vercel-preview.test.ts`

Expected: FAIL because `../../src/validators/vercel-preview.ts` does not exist.

- [x] **Step 3: Implement the external schemas**

Use strict discriminants for known event, file, and deployment states, a reusable 40-character lowercase SHA, positive integer identifiers, bounded nonempty strings, and `.passthrough()` only where GitHub or Vercel legitimately returns unrelated fields. A renamed file requires a bounded `previous_filename`; other documented file statuses retain an optional validated value. Deployment IDs use the bounded `^[A-Za-z0-9_-]+$` grammar without trimming. The pull request schema must include this complete decision surface:

```ts
export const githubPreviewPullRequestSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  labels: z.array(z.object({ name: z.string().min(1).max(100) })),
  head: z.object({
    sha: gitShaSchema,
    ref: z.string().min(1).max(255),
    repo: githubPreviewRepositorySchema,
  }),
  base: z.object({
    ref: z.string().min(1).max(255),
    repo: githubPreviewRepositorySchema,
  }),
});
```

The workflow-run schema must retain run `id`, `workflow_id`, `name`, `event`, `head_sha`, `status`, `conclusion`, creation time, and linked pull request head and base identity; the page retains nonnegative `total_count`. The live Git ref schema retains `object.sha`. Vercel metadata accepts string, number, boolean, or null values. Vercel pagination retains nonnegative `count` and finite nonnegative `next` and `prev` cursors or null. Export all inferred types and add `export * from './vercel-preview.ts';` to the validator index.

- [x] **Step 4: Run the validator tests**

Run: `bun test packages/shared/tests/validators/vercel-preview.test.ts`

Expected: PASS.

- [x] **Step 5: Write failing pure-policy tests**

Cover this truth table and identity behavior:

```ts
expect(isPreviewEligible(readyPullRequest)).toBe(true);
expect(isPreviewEligible(draftPullRequest)).toBe(false);
expect(isPreviewEligible(withLabels(draftPullRequest, ['preview']))).toBe(true);
expect(isPreviewEligible(withLabels(readyPullRequest, ['preview', 'no-preview']))).toBe(false);
expect(isSameRepositoryPullRequest(readyPullRequest)).toBe(true);
expect(isSameRepositoryPullRequest(forkPullRequest)).toBe(false);
expect(isWebPreviewFile({ filename: 'apps/web/src/app/page.tsx', status: 'modified' })).toBe(true);
expect(isWebPreviewFile({ filename: 'packages/shared/src/index.ts', status: 'modified' })).toBe(true);
expect(isWebPreviewFile({
  filename: 'docs/feature.ts',
  status: 'renamed',
  previous_filename: 'apps/web/src/feature.ts',
})).toBe(true);
expect(isWebPreviewFile({ filename: 'docs/README.md', status: 'modified' })).toBe(false);
```

Add rename-in, rename-out, and malformed-rename fixtures. Add deployment fixtures proving that a Preview must match repository ID, pull request number, ref, and SHA; a production deployment never matches; `QUEUED`, `INITIALIZING`, and `BUILDING` are active; only `READY` is ready. Reject path delimiters and whitespace in list, create, detail, and cancel IDs while accepting documented system and custom forms.

- [x] **Step 6: Run the policy tests and confirm failure**

Run: `bun test scripts/vercel-preview-policy.test.ts`

Expected: FAIL because `./vercel-preview-policy.ts` does not exist.

- [x] **Step 7: Implement the pure policy**

Use fixed label and path values:

```ts
export const PREVIEW_LABEL = 'preview';
export const NO_PREVIEW_LABEL = 'no-preview';

export function isPreviewEligible(pullRequest: GithubPreviewPullRequest): boolean {
  const labels = new Set(pullRequest.labels.map(({ name }) => name.toLowerCase()));
  if (labels.has(NO_PREVIEW_LABEL)) return false;
  return !pullRequest.draft || labels.has(PREVIEW_LABEL);
}

function isWebPreviewPath(filename: string): boolean {
  return (
    filename.startsWith('apps/web/') ||
    filename.startsWith('packages/') ||
    filename === 'package.json' ||
    filename === 'bun.lock' ||
    filename === 'tsconfig.base.json'
  );
}

export function isWebPreviewFile(file: GithubPreviewFile): boolean {
  return isWebPreviewPath(file.filename) ||
    (file.status === 'renamed' && isWebPreviewPath(file.previous_filename));
}
```

`matchesVercelPullRequest` receives the configured project ID, requires exact `projectId` and `target === null`, and compares normalized metadata values for `orbitGithubRepositoryId`, `orbitGithubPrNumber`, `orbitGithubHeadRef`, and, when supplied, `orbitGithubHeadSha`. Production, staging, missing target, another project, and absent metadata never match.

- [x] **Step 8: Run Task 1 checks and commit**

Run: `bun test packages/shared/tests/validators/vercel-preview.test.ts scripts/vercel-preview-policy.test.ts`

Run: `bun run --filter '@orbit/shared' typecheck && bun x tsc -p scripts/tsconfig.json --noEmit`

Expected: all commands PASS.

Commit: `feat(ci): define preview deployment policy`

---

### Task 2: Trusted GitHub and Vercel reconciler

**Files:**
- Create: `scripts/vercel-preview-deploy.ts`
- Test: `scripts/vercel-preview-deploy.test.ts`

**Interfaces:**
- Consumes all Task 1 schemas, types, constants, and pure policy functions.
- Produces `PreviewRuntime`, `PreviewResult`, and `reconcileVercelPreviews(runtime): Promise<readonly PreviewResult[]>`.
- `PreviewRuntime` supplies `env`, `readText`, `fetch`, `sleep`, `scheduleTimeout`, `now`, and `log` so tests never access the network, process secrets, clocks, timers, or real event files.
- `PreviewResult` is a closed discriminated union with `kind: 'skipped' | 'created' | 'canceled'`, a pull request number, and a stable reason. `created` and each `canceled` result include deployment ID and URL; `skipped` results do not. An active poll can return a canceled result when its exact head becomes ineligible, or `stale-event` without cancellation when identity drifts. No serialized result may contain either token. Candidates and canceled results are sorted for deterministic output.
- One monotonic 23-minute controller deadline bounds every request, retry, pagination loop, observation, poll, and sleep beneath the workflow's 25-minute timeout.

Use this closed reason vocabulary: `event-not-actionable`, `workflow-run-unassociated`, `stale-event`, `repository-mismatch`, `fork-pull-request`, `base-mismatch`, `preview-eligible`, `no-active-deployment`, `web-unaffected`, `ci-unavailable`, `ci-not-current`, `ci-not-green`, `ready-deployment-reused`, `active-deployment-reused`, `created-ready`, and `canceled-active`. Stale candidate identity and pre-creation pull request state changes return `stale-event`. A cancellation abandoned because the live pull request became eligible returns `preview-eligible`. Configuration, malformed external data, incomplete pagination, transport failure, deployment-response identity drift, and terminal build failure throw redacted errors rather than returning a skipped result.

- [x] **Step 1: Write failing event and eligibility tests**

Use an injected fetch router that records method, URL, headers, and parsed body. Cover:

- A successful `workflow_run` for the current ready same-repository head creates one deployment.
- `pull_request_target` ready and `preview` transitions create only when the exact SHA already has a successful CI run.
- Draft without `preview`, either control label combination, stale event SHA, fork head, wrong base, failed CI, in-progress CI, and unrelated files create zero deployments. Rename-in and rename-out changes affecting a web path create, while malformed rename history fails closed.
- `closed`, converted-to-draft, and `no-preview` transitions cancel matching active deployments without requiring CI; a stale state event cannot cancel a different live head.
- `repository_dispatch` parses its pull request input and follows the same live-state and CI checks.
- An empty workflow-run pull request list fails closed because it cannot prove the run's base SHA and repository association. More than one distinct linked pull request also fails closed because the workflow cannot provide per-PR serialization for that event.
- Duplicate workflow-run associations resolve a pull request once, event and embedded PR numbers must agree, and event repository identity must match `GITHUB_REPOSITORY` plus the live base repository.
- GitHub files paginate until a short page, with a 30-page cap and early relevant-file exit. Workflow runs paginate against `total_count` with a 10-page cap. A full final files page or an unexhausted run count fails closed.
- A newer queued, failed, canceled, or stale-base run blocks an older success. Equal creation times use the larger run ID. Wrong canonical workflow path, name, ID, or state fails closed.

The creation assertion must inspect the exact request:

```ts
expect(createRequest.method).toBe('POST');
expect(createRequest.url).toContain('/v13/deployments');
expect(createRequest.url).not.toContain('forceNew=1');
expect(createRequest.body).toEqual({
  name: 'orbit',
  project: 'prj_orbit',
  gitSource: {
    type: 'github',
    repoId: 123,
    ref: 'feature/preview',
    sha: SHA,
  },
  meta: {
    orbitDeploymentReason: 'ci-green-pr-preview',
    orbitGithubHeadRef: 'feature/preview',
    orbitGithubHeadSha: SHA,
    orbitGithubPrNumber: '341',
    orbitGithubRepositoryId: '123',
    orbitGithubWorkflowRunId: '987654321',
  },
});
expect(createRequest.body).not.toHaveProperty('target');
```

- [x] **Step 2: Run the focused tests and confirm failure**

Run: `bun test scripts/vercel-preview-deploy.test.ts --test-name-pattern 'event|eligibility|creates'`

Expected: FAIL because `./vercel-preview-deploy.ts` does not exist.

- [x] **Step 3: Implement event resolution and GitHub reconciliation**

Parse `GITHUB_EVENT_NAME`, read `GITHUB_EVENT_PATH`, and select the matching event schema. Resolve candidates as follows:

```ts
type PreviewCandidate = {
  readonly number: number;
  readonly expectedHeadSha: string | null;
};
```

- `pull_request_target`: one candidate from the matching event and embedded PR number plus event head SHA; `closed` and `synchronize` are accepted transitions.
- `workflow_run`: no candidates unless the workflow is `CI`, source event is `pull_request`, conclusion is `success`, action is `completed`, and the payload links exactly one distinct pull request; duplicate links to that same number are deduplicated. Empty or ambiguous linked lists log a stable reason and return no candidates.
- `repository_dispatch`: one candidate from the validated positive integer `client_payload.pull_request` and no expected SHA.

For every candidate, refetch `/repos/{owner}/{repo}/pulls/{number}` and prove event repository ID and slug, base repository ID, base ref `main`, same-repository head, and exact expected SHA when one exists. A fork or unrelated repository is a no-op. Current closed, draft, or label-ineligible state follows the cancellation path without requiring successful CI.

For every eligible candidate, resolve `/repos/{owner}/{repo}/actions/workflows/ci.yml` and require exact path `.github/workflows/ci.yml`, name `CI`, and active state. Fetch `/repos/{owner}/{repo}/git/ref/heads/main`, then paginate `/repos/{owner}/{repo}/actions/workflows/{workflowId}/runs?event=pull_request&head_sha={sha}&per_page=100&page=N`. Require a stable `total_count`, stop only when that count is exhausted, and fail after ten pages if results remain. Select the maximum `(created_at, id)` pair before checking conclusion. Require its workflow ID, event, status, conclusion, linked pull request number, head repository ID, ref, and SHA, base repository ID and ref, and linked base SHA equal to the separately fetched live `main` SHA. This prevents an older green run from winning over newer queued, failed, canceled, or stale-base work.

Query pull request files with `per_page=100&page=N`. Return true as soon as an `isWebPreviewFile` match appears against either the current path or a renamed file's validated previous path. A short page proves no relevant path; a full page at the 30-page cap fails closed. Immediately before a create or cancel mutation, refetch the live pull request. Before create, repeat the live-main and latest-CI proof, then refetch the pull request once more after that proof. Abort the mutation when identity, head, state, labels, base, or CI changed during reconciliation.

- [x] **Step 4: Write failing idempotency and cancellation tests**

Cover Vercel pages with an exact deployment on page 2 and prove:

- Exact `QUEUED`, `INITIALIZING`, `BUILDING`, or `READY` produces no create call.
- Exact `CANCELED`, `ERROR`, `BLOCKED`, or `DELETED` allows exactly one forced create call.
- Same SHA in another project, staging or production target, missing target, repository, pull request, or ref does not suppress creation.
- A list item without metadata is ignored without rejecting its page.
- An ineligible current state cancels every matching active Preview for that PR and does not cancel ready, canceled, errored, staging, production, another project, ref, or repository.
- An existing active deployment is polled instead of duplicated; an existing ready deployment is reused.
- A created or reused active deployment is canceled by its polling owner when the same exact head becomes ineligible before `READY`. When only the SHA changes for the same head ref and pull request identity, the owner cancels its superseded active deployment. Other identity changes return `stale-event` without cancellation.
- Every trusted eligible reconciliation cancels only validated active prior-head deployments with a different valid SHA and exact project, repository, pull request, and head ref metadata. READY prior-head deployments remain available.
- Exact READY wins over duplicate active and terminal items; exact active wins over terminal items.
- Successful create, detail, and cancel responses must retain requested ID, project, null target, and Orbit metadata. Cancel must return `CANCELED`.
- A cancel 400 or ambiguous response reads detail once and accepts a now-terminal state without retrying PATCH; an active or identity-drifted detail fails.
- A second reconciliation after creation sees the created metadata and is a no-op.

- [x] **Step 5: Run the idempotency tests and confirm failure**

Run: `bun test scripts/vercel-preview-deploy.test.ts --test-name-pattern 'existing|cancel|duplicate|pagination'`

Expected: FAIL because deployment listing, matching, and cancellation are not implemented.

- [x] **Step 6: Implement bounded Vercel reconciliation**

List `/v7/deployments` with `teamId`, `projectId`, `branch`, `sha` where appropriate, and `limit=100`. The current endpoint has no documented metadata query. Follow validated `pagination.next` through `until`, preserve every original filter, reject repeated cursors including zero, and fail when a non-null cursor remains at the finite page cap. Filter again in trusted code with exact project, null target, and `matchesVercelPullRequest`. Parse list identifiers from `uid`; create, detail, and cancel responses use `id`. Accept `url: null` only on list items.

Before current-head CI, list the branch without SHA and cancel active prior-head deployments only when their metadata carries a different valid 40-character hexadecimal SHA and exact project, repository ID, pull request number, and head ref. Run this sweep for every trusted current candidate so `workflow_run` and `repository_dispatch` repair a missed `synchronize` cleanup. Leave every non-active state, including READY, unchanged.

For eligible PRs, prefer any exact ready deployment, then any exact active deployment, then terminal history. Fetch detail when a READY list item has no URL. Poll an active deployment immediately, then allow at most 240 five-second sleeps followed by a final GET. After every active detail response, refetch live pull request identity and eligibility. If the same exact head is now closed or ineligible, cancel only that exact deployment and return its canceled result. If only the SHA changed for the same pull request identity and head ref, cancel the superseded active deployment. Other identity drift returns `stale-event` without canceling. Keep per-PR serialization and `cancel-in-progress: false`. The 23-minute controller deadline may stop this sequence earlier. Require ID, project, null target, and Orbit metadata on every detail. `READY` with a nonempty URL succeeds; `ERROR`, `CANCELED`, `BLOCKED`, or `DELETED` fails; an active final response times out.

When no ready or active exact deployment exists, create one deployment with `POST /v13/deployments?teamId={teamId}`, omitted `target`, exact Git source, and the metadata shown in Step 1. Add `forceNew=1` only when the complete pre-create list already contained an exact terminal deployment. Record all pre-create deployment IDs and enforce one POST per reconciliation.

Immediately before every Create or Cancel mutation, read `/v9/projects/{projectId}?teamId={teamId}` and validate the response. Require its project ID, project name, and account ID to equal the configured project ID, project name, and team ID. Repeat this proof at each mutation boundary so a long poll cannot rely on stale project ownership.

An ambiguous create outcome is a network error, timeout, 429, 5xx, 409, or successful response that cannot be parsed, validated, or matched to the requested identity. Ordinary 4xx responses are definitive. After ambiguity, set `createAttempted` and make a second POST impossible. Run three exact-list observation attempts separated by two seconds. Reuse only a newly visible ready or active ID that was not in the pre-create set. A new terminal deployment or no new exact ID fails visibly. A later event starts a new reconciliation from a complete list and may decide independently.

For current ineligible state, list with `teamId`, `projectId`, `branch`, and `limit=100` without SHA, then call `PATCH /v12/deployments/{id}/cancel?teamId={teamId}` only for locally matched active Preview deployments. Refetch and revalidate live pull request identity and ineligibility immediately before every individual PATCH. Never retry PATCH. Validate a successful cancel as the requested ID, project, null target, Orbit metadata, and `CANCELED`, then emit one `canceled-active` result. After a 400 or ambiguous PATCH, read v13 detail once; accept `CANCELED`, `READY`, or another terminal state as a completed race with no active spend, and fail if the deployment remains active or its identity drifted. Race-only reconciliation emits `no-active-deployment`; mixed reconciliation emits results only for deployments actually canceled. A CI failure does not cancel a previously ready Preview; cancellation is driven by current pull request state.

- [x] **Step 7: Write failing transport and secret-safety tests**

Cover missing configuration, 401, ordinary 403, rate-limited GitHub 403, 429 with delta-seconds and HTTP-date `Retry-After`, 500, network failure, body-read failure, a real injected timeout abort, redirects, invalid JSON, invalid schema, endpoint-specific exhausted or repeated pagination, polling timeout, every terminal build state, and malformed create/detail/cancel responses. Assert safe GET requests use at most three total attempts; ordinary 401/403 do not retry; explicit GitHub rate-limit 403, 429, 5xx, network failure, body-read failure, and timeout may retry within the same cap; and excessive waits fail rather than sleeping without bound.

Assert network, timeout, 429, 500, invalid-success body, and 409 create outcomes each perform one POST total and enter the three-attempt exact-list observation. Active or ready visibility is reused; terminal or absent visibility fails. Assert definitive 400, 401, 403, and 422 create responses send no reconciliation retry and no second POST. Cover cancel 400 plus ambiguous PATCH network, 429, 5xx, and invalid-success outcomes with one PATCH and one detail reconciliation. Assert exact mutation, observation, detail, and bounded-sleep counts. No error body, thrown error, log line, URL, request summary, external deployment ID, or serialized result may contain either token.

- [x] **Step 8: Implement the bounded JSON client and CLI entry point**

The JSON client applies a fresh 15-second AbortController per request through the injected timer scheduler and clears its timer after body consumption. It rejects redirects and sends a fixed `User-Agent`; GitHub requests also send `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`. Parse response text as JSON, validate with the supplied shared schema, and throw only a token-redacted bounded error. Never include headers or raw external bodies in errors. Validate every deployment ID with the shared safe grammar, check it against both tokens before use, and encode every dynamic Vercel deployment path segment.

Safe GET reads retry network errors, per-attempt timeout, 429, 5xx, and GitHub 403 only with explicit rate-limit evidence. Cap total read attempts at three. Parse delta-seconds and HTTP-date `Retry-After` using injected `now`, bound any sleep to 30 seconds, and treat invalid or excessive waits as failure. Mutations are single-attempt and use the explicit create-observation or cancel-detail rules from Step 6 instead of transport retries.

The executable path uses `Bun.file(path).text()`, global `fetch`, a timer-backed sleep, and `console.log`. Guard it with `if (import.meta.main)`, set `process.exitCode = 1` on error, and print only the redacted error message.

- [x] **Step 9: Run Task 2 checks and commit**

Run: `bun test scripts/vercel-preview-deploy.test.ts`

Run: `bun x tsc -p scripts/tsconfig.json --noEmit && bun run lint -- scripts/vercel-preview-deploy.ts scripts/vercel-preview-deploy.test.ts`

Expected: all commands PASS.

Commit: `feat(ci): deploy previews after successful checks`

---

### Task 3: Trusted workflow, Vercel configuration, labels, and operations guide

**Files:**
- Create: `.github/workflows/vercel-preview.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/web/vercel.json`
- Modify: `scripts/labels.ts`
- Delete: `scripts/vercel-build-gate.sh`
- Delete: `scripts/vercel-build-gate.test.ts`
- Create: `scripts/vercel-preview-config.test.ts`
- Rewrite: `docs/VERCEL_BUILD_GATE.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes `scripts/vercel-preview-deploy.ts` as the only workflow command.
- Requires secret `VERCEL_TOKEN` and variables `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_PROJECT_NAME`.
- Uses immutable `actions/checkout` SHA `3d3c42e5aac5ba805825da76410c181273ba90b1` and immutable `oven-sh/setup-bun` SHA `0c5077e51419868618aeaa5fe8019c62421857d6`.
- Produces managed labels named exactly `preview` and `no-preview`.

- [x] **Step 1: Write failing repository configuration tests**

Parse `apps/web/vercel.json`, read the workflow and docs as text, and import `LABELS`. Assert the branch map and removal checks below, then use anchored assertions over the intentionally fixed workflow structure rather than global word searches:

```ts
expect(vercel.git.deploymentEnabled).toEqual({ '**': false, main: true });
expect(vercel).not.toHaveProperty('ignoreCommand');
expect(LABELS.filter(({ name }) => name === 'preview')).toHaveLength(1);
expect(LABELS.filter(({ name }) => name === 'no-preview')).toHaveLength(1);
expect(allGateFiles).not.toContain('BUILD_GATE_GITHUB_TOKEN');
```

Require the exact top-level read-only permissions; only the three intended triggers and their exact activity types; no `workflow_dispatch`; the workflow-run job guard for a `pull_request` source and `success` conclusion; `timeout-minutes: 25`; and `cancel-in-progress: false`. Require the exact immutable checkout and setup-Bun SHAs, checkout of `${{ github.repository }}` at `${{ github.sha }}`, disabled persisted credentials, submodules, and LFS, Bun 1.3.14, and `bun install --frozen-lockfile --ignore-scripts`. Prove no cache or artifact-download action exists, no pull request head/ref expression can select checkout code, and the controller is the only run step receiving `VERCEL_TOKEN`.

Assert the `static` job, rather than merely the whole CI file, contains named `bun run check-bytes` and `bun run check-bun-imports` steps. Assert each managed label description matches its executable semantics: `preview` enables an otherwise eligible draft after CI, while `no-preview` suppresses creation and cancels active Preview work. Assert the deployment map is exactly `{ '**': false, main: true }`, with the wildcard rule before the `main` override, without claiming that the test executes Vercel's glob matcher.

- [x] **Step 2: Run the configuration test and confirm failure**

Run: `bun test scripts/vercel-preview-config.test.ts`

Expected: FAIL because the workflow and managed labels do not exist and `ignoreCommand` remains.

- [x] **Step 3: Replace the Vercel gate and manage labels**

Remove `ignoreCommand` from `apps/web/vercel.json` and add:

```json
"git": {
  "deploymentEnabled": {
    "**": false,
    "main": true
  }
}
```

Add `preview` and `no-preview` beside the status labels in `scripts/labels.ts`, with descriptions matching the design. Delete the old shell gate and its tests. Keep the root `bun test scripts` command so all new script tests remain part of CI.

Add named `Source byte policy` and `No Bun built-ins in shipped server code` steps to the `static` job in `.github/workflows/ci.yml`, invoking `bun run check-bytes` and `bun run check-bun-imports`. This makes the canonical `CI` success used by the dispatcher cover every non-test verification command from `bun run verify`.

- [x] **Step 4: Add the default-branch workflow**

Create a workflow named `Vercel Preview` with this trigger and trust boundary:

```yaml
on:
  pull_request_target:
    branches: [main]
    types: [opened, reopened, synchronize, ready_for_review, converted_to_draft, labeled, unlabeled, closed]
  workflow_run:
    workflows: [CI]
    types: [completed]
  repository_dispatch:
    types: [vercel-preview-reconcile]

permissions:
  actions: read
  contents: read
  pull-requests: read

concurrency:
  group: vercel-preview-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.event.client_payload.pull_request || github.event.workflow_run.head_sha || github.run_id }}
  cancel-in-progress: false
```

Keep `cancel-in-progress: false`: canceling a controller after an ambiguous Create could lose its read-only observation and permit a later duplicate attempt. Timely ineligibility and same-ref head supersession are handled inside the polling owner, which refetches exact live identity and eligibility after every active detail response.

The controller rejects a workflow run linked to more than one distinct pull request, so the first linked number is used only for an event that resolves to one PR. Recovery requires a positive numeric `client_payload.pull_request`, which shares the same per-PR group as state and CI events; malformed recovery input may form an unused group but is rejected before any Vercel call. The job condition allows state events and repository dispatch, and allows a workflow run only when `github.event.workflow_run.event == 'pull_request'` and its conclusion is success. Set `timeout-minutes: 25`; the controller's own 23-minute deadline remains the primary bound. GitHub documents that `repository_dispatch` uses the last commit on the default branch, unlike `workflow_dispatch`, which can run a workflow version from a selected non-default ref. Checkout the trusted default-branch workflow commit using the pinned checkout action, `repository: ${{ github.repository }}`, `ref: ${{ github.sha }}`, `persist-credentials: false`, `submodules: false`, and `lfs: false`. Set up Bun 1.3.14 with the pinned setup action, run `bun install --frozen-lockfile --ignore-scripts`, then run `bun scripts/vercel-preview-deploy.ts` with tokens and settings scoped only to that controller step through `env`.

- [x] **Step 5: Rewrite the operations guide and documentation index**

Document the exact eligibility table, CI-green timing, same-repository restriction, active cancellation including closed pull requests, web path list, Vercel API behavior, GitHub secret and variables, label synchronization, Git Fork Protection, the deployment-count caveat, the repository-controlled cost-policy limitation, and removal of all four old `BUILD_GATE_*` Vercel values. State precisely that only the trusted GitHub controller is isolated from pull request code: the API-created Vercel Preview still builds same-repository pull request code with the project's Preview environment scope. Manual recovery uses a maintainer-authenticated `repository_dispatch` named `vercel-preview-reconcile` with numeric `client_payload.pull_request`; explicitly forbid `workflow_dispatch` because a caller can select a non-default ref. Link the guide from `docs/README.md` under the contributor/operations entries.

Make the post-merge canary an ordered procedure: confirm Git Fork Protection and configure the secret plus three variables; remove the four legacy values only after the workflow is on `main`; open a same-repository web-impacting draft and prove no Preview until `preview` is applied and exact-head CI succeeds; on a new active head, add `no-preview` and prove the polling owner cancels that exact deployment before `READY` while an older ready URL remains; make the PR ready, push a new relevant head, and prove only that exact SHA deploys; then repeat with a docs-only change and a fork and prove neither gets an automatic Preview.

Do not claim that ignored builds are free, that Ready alone is trust, that fork previews are automatic, or that the privileged workflow can be exercised before it exists on `main`.

- [x] **Step 6: Run Task 3 checks and commit**

Run: `bun test scripts/vercel-preview-config.test.ts scripts/vercel-preview-policy.test.ts scripts/vercel-preview-deploy.test.ts packages/shared/tests/validators/vercel-preview.test.ts`

Run: `bun run lint && bun run check-comments && bun run check-bytes && bun run check-bun-imports && bun run typecheck`

Expected: all commands PASS.

Run: `rg -n 'BUILD_GATE_|vercel-build-gate|Generated[[:space:]]with' apps/web/vercel.json scripts .github/workflows/vercel-preview.yml`

Run: `rg -n 'Generated[[:space:]]with' docs/VERCEL_BUILD_GATE.md docs/README.md`

Expected: no old gate setting, prohibited attribution, or em-dash match. A link or historical plan outside this task's changed files is not edited.

Commit: `chore(vercel): gate previews after CI`

---

### Task 4: Full verification and existing pull request handoff

**Files:**
- Modify only files required by current-main conflict resolution or a verification failure caused by this branch.
- Update remote pull request 341 body and review-thread replies after the branch is verified and pushed.

**Interfaces:**
- Consumes the complete branch from Tasks 1 through 3.
- Produces a branch merged with current `origin/main`, a green local verification record, an updated remote branch, an accurate PR body, and resolved addressed threads.

- [x] **Step 1: Merge the latest main and rerun focused tests**

Run: `git fetch origin main && git merge --no-edit origin/main`

Resolve `package.json` by retaining `"test": "bun test scripts && bun run --filter '*' test"` and every current-main override. Do not touch the dirty ordinary checkout.

Run: `bun install --frozen-lockfile`

Run: `bun test scripts/vercel-preview-config.test.ts scripts/vercel-preview-policy.test.ts scripts/vercel-preview-deploy.test.ts packages/shared/tests/validators/vercel-preview.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the complete repository verification**

Run: `ORBIT_TEST_LANE=preview-gate bun run verify`

Expected: lint, comment policy, source-byte check, Bun-import check, dependency dedupe, all typechecks, and all tests PASS. If a database service is unavailable, start the repository's existing infrastructure and initialize only the isolated `preview-gate` test lane before rerunning.

- [x] **Step 3: Review the final diff and operational text**

Run: `git diff --check origin/main...HEAD`

Run: `git diff --stat origin/main...HEAD && git log --oneline origin/main..HEAD`

Run the attribution and em-dash scan against every changed text file. Run the four legacy-setting scan against changed code and workflow files, excluding `docs/VERCEL_BUILD_GATE.md`, where the removal instructions intentionally name them.

Expected: no whitespace error, prohibited attribution, em dash, or old token/config reference in changed files except the operations guide's explicit removal instructions for the four legacy setting names.

- [x] **Step 4: Push and update pull request 341**

Push `chore/gate-preview-builds` after all local checks pass. Replace the PR body with the final motivation, architecture, security boundary, setup requirements, test evidence, and the honest post-merge canary limitation. Remove the stale test count and all attribution.

Reply to the unresolved event-trigger review thread with the trusted workflow and exact event paths. Reply to the old Greptile thread with the final test coverage. Resolve a thread only when its cited issue is demonstrably addressed by the pushed diff.

- [ ] **Step 5: Inspect hosted checks and merge readiness**

Wait for CodeRabbit, Greptile, GitHub Actions, and Vercel/GitHub deployment checks to complete. Reconcile every current head comment and check. Do not merge while a required check is red, a current thread is unresolved, the branch is behind `main`, or a human approval is still required.

The PR is ready to merge when current-main ancestry, hosted checks, review threads, required approval, labels, GitHub secret/variables, and the documented Vercel project settings are all confirmed. The privileged deployment behavior receives its real canary only after the workflow exists on `main`.
