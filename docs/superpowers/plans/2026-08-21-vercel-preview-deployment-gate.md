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
- Web-impacting paths are `apps/web/**`, `packages/**`, `package.json`, `bun.lock`, and `tsconfig.base.json`.
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
- Produces `githubPreviewPullRequestSchema`, `githubPreviewPullRequestTargetEventSchema`, `githubPreviewWorkflowRunEventSchema`, `githubPreviewWorkflowDispatchEventSchema`, `githubPreviewFilesSchema`, `githubPreviewWorkflowRunsSchema`, `githubPreviewCommitPullsSchema`, `vercelDeploymentSchema`, `vercelDeploymentsPageSchema`, `vercelCreatedDeploymentSchema`, and `vercelPreviewEnvironmentSchema`.
- Produces inferred `GithubPreviewPullRequest`, `VercelDeployment`, and `VercelPreviewEnvironment` types.
- Produces `PREVIEW_LABEL`, `NO_PREVIEW_LABEL`, `isPreviewEligible`, `isSameRepositoryPullRequest`, `isWebPreviewFile`, `isActiveVercelDeployment`, `isReadyVercelDeployment`, and `matchesVercelPullRequest`.
- The controller in Task 2 consumes every interface above and does not define a second copy of validation or policy.

- [ ] **Step 1: Write failing validator tests**

Create fixtures with a 40-character lowercase SHA and assert the schemas accept a complete open pull request, state event, successful CI workflow event, manual input, GitHub file page, workflow-run page, Vercel deployment page, create response, and complete environment. Add rejection cases for a short SHA, missing repository ID, missing draft state, unknown Vercel ready state, nonnumeric manual pull request input, pagination without a finite cursor, and missing secrets.

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

- [ ] **Step 2: Run the validator test and confirm failure**

Run: `bun test packages/shared/tests/validators/vercel-preview.test.ts`

Expected: FAIL because `../../src/validators/vercel-preview.ts` does not exist.

- [ ] **Step 3: Implement the external schemas**

Use strict discriminants for known event and deployment states, a reusable 40-character lowercase SHA, positive integer identifiers, bounded nonempty strings, and `.passthrough()` only where GitHub or Vercel legitimately returns unrelated fields. The pull request schema must include this complete decision surface:

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

The workflow-run schema must retain `name`, `event`, `head_sha`, `conclusion`, and pull request numbers. Vercel metadata accepts string, number, boolean, or null values. Vercel pagination accepts finite nonnegative `next` and `prev` cursors or null. Export all inferred types and add `export * from './vercel-preview.ts';` to the validator index.

- [ ] **Step 4: Run the validator tests**

Run: `bun test packages/shared/tests/validators/vercel-preview.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing pure-policy tests**

Cover this truth table and identity behavior:

```ts
expect(isPreviewEligible(readyPullRequest)).toBe(true);
expect(isPreviewEligible(draftPullRequest)).toBe(false);
expect(isPreviewEligible(withLabels(draftPullRequest, ['preview']))).toBe(true);
expect(isPreviewEligible(withLabels(readyPullRequest, ['preview', 'no-preview']))).toBe(false);
expect(isSameRepositoryPullRequest(readyPullRequest)).toBe(true);
expect(isSameRepositoryPullRequest(forkPullRequest)).toBe(false);
expect(isWebPreviewFile('apps/web/src/app/page.tsx')).toBe(true);
expect(isWebPreviewFile('packages/shared/src/index.ts')).toBe(true);
expect(isWebPreviewFile('apps/realtime/src/index.ts')).toBe(false);
expect(isWebPreviewFile('docs/README.md')).toBe(false);
```

Add deployment fixtures proving that a Preview must match repository ID, pull request number, ref, and SHA; a production deployment never matches; `QUEUED`, `INITIALIZING`, and `BUILDING` are active; only `READY` is ready.

- [ ] **Step 6: Run the policy tests and confirm failure**

Run: `bun test scripts/vercel-preview-policy.test.ts`

Expected: FAIL because `./vercel-preview-policy.ts` does not exist.

- [ ] **Step 7: Implement the pure policy**

Use fixed label and path values:

```ts
export const PREVIEW_LABEL = 'preview';
export const NO_PREVIEW_LABEL = 'no-preview';

export function isPreviewEligible(pullRequest: GithubPreviewPullRequest): boolean {
  const labels = new Set(pullRequest.labels.map(({ name }) => name.toLowerCase()));
  if (labels.has(NO_PREVIEW_LABEL)) return false;
  return !pullRequest.draft || labels.has(PREVIEW_LABEL);
}

export function isWebPreviewFile(filename: string): boolean {
  return (
    filename.startsWith('apps/web/') ||
    filename.startsWith('packages/') ||
    filename === 'package.json' ||
    filename === 'bun.lock' ||
    filename === 'tsconfig.base.json'
  );
}
```

`matchesVercelPullRequest` must reject `target === 'production'` and compare normalized metadata values for `githubRepoId`, `githubPrId`, `githubCommitRef`, and, when supplied, `githubCommitSha`.

- [ ] **Step 8: Run Task 1 checks and commit**

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
- `PreviewRuntime` supplies `env`, `readText`, `fetch`, `sleep`, and `log` so tests never access the network, process secrets, or real event files.
- `PreviewResult` is a discriminated union with `kind: 'skipped' | 'created' | 'canceled'`, a pull request number, a stable reason, and an optional deployment ID and URL only for a mutation.

- [ ] **Step 1: Write failing event and eligibility tests**

Use an injected fetch router that records method, URL, headers, and parsed body. Cover:

- A successful `workflow_run` for the current ready same-repository head creates one deployment.
- `pull_request_target` ready and `preview` transitions create only when the exact SHA already has a successful CI run.
- Draft without `preview`, either control label combination, closed PR, stale event SHA, fork head, failed CI, in-progress CI, and unrelated files create zero deployments.
- `workflow_dispatch` parses its pull request input and follows the same live-state and CI checks.
- An empty workflow-run pull request list falls back to the commit-pulls endpoint.
- GitHub files and commit pulls paginate until a short page, with a hard page limit.

The creation assertion must inspect the exact request:

```ts
expect(createRequest.method).toBe('POST');
expect(createRequest.url).toContain('/v13/deployments');
expect(createRequest.url).toContain('forceNew=1');
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
    githubCommitOrg: 'Noveum',
    githubCommitRef: 'feature/preview',
    githubCommitRepo: 'orbit',
    githubCommitSha: SHA,
    githubPrId: '341',
    githubRepoId: '123',
  },
});
expect(createRequest.body).not.toHaveProperty('target');
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `bun test scripts/vercel-preview-deploy.test.ts --test-name-pattern 'event|eligibility|creates'`

Expected: FAIL because `./vercel-preview-deploy.ts` does not exist.

- [ ] **Step 3: Implement event resolution and GitHub reconciliation**

Parse `GITHUB_EVENT_NAME`, read `GITHUB_EVENT_PATH`, and select the matching event schema. Resolve candidates as follows:

```ts
type PreviewCandidate = {
  readonly number: number;
  readonly expectedHeadSha: string | null;
  readonly ciProven: boolean;
};
```

- `pull_request_target`: one candidate from the event PR number and event head SHA, with `ciProven: false`.
- `workflow_run`: no candidates unless the workflow is `CI`, source event is `pull_request`, conclusion is `success`, and action is `completed`; candidates use the workflow head SHA and `ciProven: true`; use the commit-pulls endpoint when the payload list is empty.
- `workflow_dispatch`: one candidate from the positive integer input, no expected SHA, with `ciProven: false`.

For every candidate, refetch `/repos/{owner}/{repo}/pulls/{number}` and require an open PR targeting the event repository and `main`, a same-repository head, and an exact expected SHA when one exists. Evaluate current labels and draft state next; an ineligible state event follows the cancellation path without requiring successful CI. For an eligible candidate whose `ciProven` is false, query `/repos/{owner}/{repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha={sha}&status=completed&per_page=100` and require a successful run with the same head SHA. Query pull request files with `per_page=100&page=N` and require at least one `isWebPreviewFile` match before a create.

- [ ] **Step 4: Write failing idempotency and cancellation tests**

Cover Vercel pages with an exact deployment on page 2 and prove:

- Exact `QUEUED`, `INITIALIZING`, `BUILDING`, or `READY` produces no create call.
- Exact `CANCELED` or `ERROR` allows exactly one create call.
- Same SHA in another project, production target, repository, pull request, or ref does not suppress creation.
- An ineligible state event cancels every matching active Preview for that PR and does not cancel ready, canceled, errored, production, another ref, or another repository.
- A second reconciliation after creation sees the created metadata and is a no-op.

- [ ] **Step 5: Run the idempotency tests and confirm failure**

Run: `bun test scripts/vercel-preview-deploy.test.ts --test-name-pattern 'existing|cancel|duplicate|pagination'`

Expected: FAIL because deployment listing, matching, and cancellation are not implemented.

- [ ] **Step 6: Implement bounded Vercel reconciliation**

List `/v6/deployments` with `teamId`, `projectId`, `limit=100`, and a metadata filter. Follow the validated `pagination.next` cursor with a finite page cap. Filter again in trusted code with `matchesVercelPullRequest` before using any result.

For eligible PRs, return a skipped result when an exact active or ready deployment exists. Otherwise create one deployment with `POST /v13/deployments?teamId={teamId}&forceNew=1`, omitted `target`, exact Git source, and the metadata shown in Step 1.

For ineligible state events, list by pull request metadata and call `PATCH /v12/deployments/{id}/cancel?teamId={teamId}` only for matching active Preview deployments. A CI failure does not cancel a previously ready Preview; cancellation is driven by current PR state.

- [ ] **Step 7: Write failing transport and secret-safety tests**

Cover missing configuration, 401, 403, 429 with `Retry-After`, 500, timeout abort, invalid JSON, invalid schema, exhausted pagination, and malformed create/cancel responses. Assert 429 and 5xx use at most three total attempts, 401 and 403 do not retry, and no thrown error, log line, URL, or serialized result contains either token.

- [ ] **Step 8: Implement the bounded JSON client and CLI entry point**

The JSON client must apply a 15 second abort timeout per request, retry only 429 and 5xx responses, cap attempts at three, parse response text as JSON, validate with the supplied schema, and throw a redacted error on failure. Inject `sleep` for tests. Never include request headers in an error.

The executable path uses `Bun.file(path).text()`, global `fetch`, a timer-backed sleep, and `console.log`. Guard it with `if (import.meta.main)`, set `process.exitCode = 1` on error, and print only the redacted error message.

- [ ] **Step 9: Run Task 2 checks and commit**

Run: `bun test scripts/vercel-preview-deploy.test.ts`

Run: `bun x tsc -p scripts/tsconfig.json --noEmit && bun run lint -- scripts/vercel-preview-deploy.ts scripts/vercel-preview-deploy.test.ts`

Expected: all commands PASS.

Commit: `feat(ci): deploy previews after successful checks`

---

### Task 3: Trusted workflow, Vercel configuration, labels, and operations guide

**Files:**
- Create: `.github/workflows/vercel-preview.yml`
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

- [ ] **Step 1: Write failing repository configuration tests**

Parse `apps/web/vercel.json`, read the workflow and docs as text, and import `LABELS`. Assert:

```ts
expect(vercel.git.deploymentEnabled).toEqual({ '**': false, main: true });
expect(vercel).not.toHaveProperty('ignoreCommand');
expect(LABELS.filter(({ name }) => name === 'preview')).toHaveLength(1);
expect(LABELS.filter(({ name }) => name === 'no-preview')).toHaveLength(1);
expect(workflow).toContain('pull_request_target:');
expect(workflow).toContain('workflow_run:');
expect(workflow).toContain('workflow_dispatch:');
expect(workflow).toContain('persist-credentials: false');
expect(workflow).not.toContain('github.event.pull_request.head.ref');
expect(allGateFiles).not.toContain('BUILD_GATE_GITHUB_TOKEN');
```

Also test the `**` rule against `feature`, `feature/preview`, and `codex/review/pr341` using the same `minimatch` semantics documented by Vercel. Do not add a dependency: implement the narrow expected assertion by checking that the configured key is exactly `**` and enumerate the branch examples in the test name.

- [ ] **Step 2: Run the configuration test and confirm failure**

Run: `bun test scripts/vercel-preview-config.test.ts`

Expected: FAIL because the workflow and managed labels do not exist and `ignoreCommand` remains.

- [ ] **Step 3: Replace the Vercel gate and manage labels**

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

- [ ] **Step 4: Add the default-branch workflow**

Create a workflow named `Vercel Preview` with this trigger and trust boundary:

```yaml
on:
  pull_request_target:
    types: [opened, reopened, ready_for_review, converted_to_draft, labeled, unlabeled]
  workflow_run:
    workflows: [CI]
    types: [completed]
  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number
        required: true
        type: number

permissions:
  actions: read
  contents: read
  pull-requests: read

concurrency:
  group: vercel-preview-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || inputs.pull_request || github.event.workflow_run.head_sha }}
  cancel-in-progress: false
```

The job condition allows state events and manual dispatch, and allows a workflow run only when `github.event.workflow_run.event == 'pull_request'`. Checkout the trusted default-branch workflow commit using the pinned checkout action, `repository: ${{ github.repository }}`, `ref: ${{ github.sha }}`, `persist-credentials: false`, `submodules: false`, and `lfs: false`. Set up Bun 1.3.14 with the pinned setup action, run `bun install --frozen-lockfile`, then run `bun scripts/vercel-preview-deploy.ts` with tokens and settings scoped to that step through `env`.

- [ ] **Step 5: Rewrite the operations guide and documentation index**

Document the exact eligibility table, CI-green timing, same-repository restriction, active cancellation, web path list, Vercel API behavior, GitHub secret and variables, label synchronization, Git Fork Protection, the deployment-count caveat, the repository-controlled cost-policy limitation, removal of all four old `BUILD_GATE_*` Vercel values, manual recovery, and the post-merge canary. Link the guide from `docs/README.md` under the contributor/operations entries.

Do not claim that ignored builds are free, that Ready alone is trust, that fork previews are automatic, or that the privileged workflow can be exercised before it exists on `main`.

- [ ] **Step 6: Run Task 3 checks and commit**

Run: `bun test scripts/vercel-preview-config.test.ts scripts/vercel-preview-policy.test.ts scripts/vercel-preview-deploy.test.ts packages/shared/tests/validators/vercel-preview.test.ts`

Run: `bun run lint && bun run check-comments && bun run check-bytes && bun run check-bun-imports && bun run typecheck`

Expected: all commands PASS.

Run: `rg -n 'BUILD_GATE_|vercel-build-gate|Generated with|Claude|—' apps/web/vercel.json scripts .github/workflows/vercel-preview.yml`

Run: `rg -n 'Generated with|Claude|—' docs/VERCEL_BUILD_GATE.md docs/README.md`

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

- [ ] **Step 1: Merge the latest main and rerun focused tests**

Run: `git fetch origin main && git merge --no-edit origin/main`

Resolve `package.json` by retaining `"test": "bun test scripts && bun run --filter '*' test"` and every current-main override. Do not touch the dirty ordinary checkout.

Run: `bun install --frozen-lockfile`

Run: `bun test scripts/vercel-preview-config.test.ts scripts/vercel-preview-policy.test.ts scripts/vercel-preview-deploy.test.ts packages/shared/tests/validators/vercel-preview.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the complete repository verification**

Run: `ORBIT_TEST_LANE=preview-gate bun run verify`

Expected: lint, comment policy, source-byte check, Bun-import check, dependency dedupe, all typechecks, and all tests PASS. If a database service is unavailable, start the repository's existing infrastructure and initialize only the isolated `preview-gate` test lane before rerunning.

- [ ] **Step 3: Review the final diff and operational text**

Run: `git diff --check origin/main...HEAD`

Run: `git diff --stat origin/main...HEAD && git log --oneline origin/main..HEAD`

Run the attribution and em-dash scan against every changed text file. Run the four legacy-setting scan against changed code and workflow files, excluding `docs/VERCEL_BUILD_GATE.md`, where the removal instructions intentionally name them.

Expected: no whitespace error, prohibited attribution, em dash, or old token/config reference in changed files except the operations guide's explicit removal instructions for the four legacy setting names.

- [ ] **Step 4: Push and update pull request 341**

Push `chore/gate-preview-builds` after all local checks pass. Replace the PR body with the final motivation, architecture, security boundary, setup requirements, test evidence, and the honest post-merge canary limitation. Remove the stale test count and all attribution.

Reply to the unresolved event-trigger review thread with the trusted workflow and exact event paths. Reply to the old Greptile thread with the final test coverage. Resolve a thread only when its cited issue is demonstrably addressed by the pushed diff.

- [ ] **Step 5: Inspect hosted checks and merge readiness**

Wait for CodeRabbit, Greptile, GitHub Actions, and Vercel/GitHub deployment checks to complete. Reconcile every current head comment and check. Do not merge while a required check is red, a current thread is unresolved, the branch is behind `main`, or a human approval is still required.

The PR is ready to merge when current-main ancestry, hosted checks, review threads, required approval, labels, GitHub secret/variables, and the documented Vercel project settings are all confirmed. The privileged deployment behavior receives its real canary only after the workflow exists on `main`.
