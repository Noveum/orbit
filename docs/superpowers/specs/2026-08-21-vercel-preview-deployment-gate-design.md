# Vercel Preview Deployment Gate Design

## Problem

Orbit currently lets Vercel create a Preview deployment for every pushed commit. Most pull
request commits do not need a live preview, and failed commits should not consume Vercel build
minutes. Pull request 341 attempted to reduce that cost with a repository-provided Ignored Build
Step that reads pull request state using a GitHub token.

That design has three structural problems. Vercel runs the ignored command from the pull request
checkout with environment access, so the pull request controls code that receives the GitHub
token. Ready-for-review and label changes do not create a Vercel deployment, so they cannot act as
the promised preview button. Ignored builds also still count as deployments and occupy concurrent
build capacity, even when they avoid the application build.

## Outcome

Vercel automatically deploys `main`, but does not automatically deploy feature branches. A
trusted GitHub Actions workflow creates a Preview deployment only when all of these conditions are
true for the current pull request head:

- The pull request comes from the Orbit repository rather than a fork.
- The pull request is ready for review, or carries the managed `preview` label.
- The pull request does not carry the managed `no-preview` label.
- The `CI` workflow completed successfully for the exact head SHA.
- At least one changed file affects the web deployment.
- No active or ready Preview deployment already exists for the same pull request and SHA.

The `no-preview` label wins when both control labels are present. Converting a pull request back to
draft also makes it ineligible unless `preview` remains present. When a state change makes a pull
request ineligible, the workflow cancels active Preview deployments for that pull request but does
not delete completed previews. The reconciler that owns an active deployment poll checks live pull
request state after every active detail response, so it can cancel its exact deployment while a
later state event waits in the serialized workflow group.

This design optimizes for avoided Vercel application builds. The small GitHub metadata job still
uses GitHub Actions time, and an API-created eligible preview is still a normal Vercel deployment.

## Deployment ownership

`apps/web/vercel.json` replaces the Ignored Build Step with a Git deployment rule:

```json
{
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
```

The minimatch catch-all prevents automatic Preview deployments, including branch names containing
slashes. The explicit `main` rule preserves the existing production path. Vercel documents that a
true match wins when more than one branch rule matches, so `main` remains enabled even though it
also matches `**`. Unspecified branches default to enabled, which is why a single-star pattern is
not sufficient.

This repository setting is an operational cost policy, not a security boundary. A same-repository
author can change `vercel.json` in a branch, and Vercel does not document that the deployment rule
is always read from the default branch. Git Fork Protection remains the security boundary for
forks. A future move to a disconnected or dedicated Preview project can make automatic-deployment
suppression independent of pull request contents; that external migration is not required to
remove the token exposure or to stop normal feature-branch builds in this change.

The repository removes `scripts/vercel-build-gate.sh` and its tests. The trusted GitHub controller
never exposes `VERCEL_TOKEN` to a pull request checkout, and the gate no longer depends on Vercel
system environment variables or an ignored-build exit-code convention. The Preview deployment
still builds same-repository pull request code inside Vercel and can receive that project's Preview
environment values. Same-repository authors therefore remain inside the Vercel project trust
boundary.

## Trusted workflow

`.github/workflows/vercel-preview.yml` runs from the default branch through three trusted event
paths:

- `pull_request_target` handles `opened`, `reopened`, `synchronize`, `ready_for_review`,
  `converted_to_draft`, `labeled`, `unlabeled`, and `closed` state transitions.
- `workflow_run` handles a completed `CI` workflow and proceeds only when the source event was a
  pull request and the conclusion was success.
- `repository_dispatch` accepts the custom `vercel-preview-reconcile` event with a pull request
  number for maintainer recovery when an event was missed or a deployment needs to be retried.

The workflow checks out only the trusted workflow SHA from the default branch with persisted Git
credentials disabled. It never
fetches, checks out, installs, builds, caches, or executes the pull request head, and it never
downloads an artifact from the untrusted CI run. Pull request data appears only in environment
values and API request bodies, never as shell source.

Permissions are limited to `actions: read`, `contents: read`, and `pull-requests: read`. The Vercel
token is a GitHub Actions secret. Team ID, project ID, and project name are Actions variables.
Concurrency is keyed by pull request number when the event supplies one and does not cancel an
in-progress reconciler. Recovery dispatches require a bounded positive numeric pull request input
and share that pull request's group. Vercel metadata checks provide a second idempotency boundary.
A polling owner refetches the current pull request between active deployment reads. It cancels only
the deployment whose validated metadata names the same pull request head when that exact identity
becomes closed or ineligible. It also cancels that deployment when only the head SHA is superseded
and the pull request, repositories, base, and head ref still match. Other identity drift ends the old
poll without mutation. This keeps one Create POST and per-pull-request serialization while allowing
timely cost cancellation.
A workflow-run payload with no linked pull request, or with more than one distinct linked pull
request, is rejected because one Actions concurrency group cannot serialize multiple pull requests
and the event cannot prove one unambiguous base association.

## Controller and validation

`scripts/vercel-preview-deploy.ts` is the only executable controller. It imports Zod schemas from
`@orbit/shared/validators` and validates the GitHub event payload, every GitHub response, every
Vercel response, and configuration before using them.

The controller resolves one pull request number from an actionable event, then refetches that pull
request from GitHub. Duplicate links to the same pull request are deduplicated. An event is stale
when its recorded head SHA no longer equals the live pull request head. Stale events are no-ops.
Fork heads and pull requests targeting another repository or branch are also no-ops. A proven
closed pull request follows the active-cancellation path without requiring CI.

Before CI, every trusted current-candidate reconciliation lists the branch and cancels only active
prior-head deployments with a different valid 40-character hexadecimal SHA and exact project,
repository ID, pull request number, and head ref metadata. This lets `synchronize` cancel promptly
and lets later CI or recovery events repair a missed cleanup. READY prior-head deployments remain
unchanged.

For every eligible event, the controller resolves the canonical `.github/workflows/ci.yml`, fetches
the live `main` ref, and queries every bounded page of runs for the exact head SHA. It selects the
maximum creation time and run ID rather than filtering to successful runs. The run must be
completed successfully and its linked pull request must match the current number, repository IDs,
head ref and SHA, base ref, and live base SHA. A newer queued, failed, canceled, or stale-base run
blocks deployment even when an older green run exists. The triggering `workflow_run` is only a
wake-up signal and is not trusted as proof. Immediately before mutation, the controller refetches
live pull request state and repeats the current CI proof. It then refetches the pull request once
more after that proof and requires the exact identity, head, state, and labels to remain eligible
before the Create POST, so a transition during the proof cannot authorize stale work.

Changed files are read from the paginated pull request files endpoint. Each item retains its
validated GitHub status, and a renamed item must include a bounded `previous_filename`. The web
deployment is affected when either the current filename or, for a rename, the previous filename is
below `apps/web/` or `packages/`, or is exactly `package.json`, `bun.lock`, or
`tsconfig.base.json`. Configuration is fixed in trusted code rather than split between Vercel and
GitHub settings.

GitHub and Vercel requests have a finite timeout. One monotonic 23-minute reconciliation deadline
also bounds every request, retry, pagination loop, observation, poll, and sleep beneath the
workflow's 25-minute job limit. Safe reads use bounded retries for network failures, server
failures, 429 responses, and 403 responses carrying explicit GitHub rate-limit evidence. Mutations
are never retried blindly. Authentication failures, malformed payloads, exhausted pagination, and
unsuccessful mutations fail the workflow visibly. Redirects are rejected for token-bearing
requests, and logs never contain either token.

## Vercel API contract

Before mutation, the controller lists deployments through Vercel's current `/v7/deployments`
endpoint, using the configured project plus branch and SHA filters where applicable. It filters
again by exact project ID, null Preview target, and namespaced Orbit metadata for repository ID,
pull request number, branch ref, and commit SHA. List metadata may be absent on unrelated historical
deployments. Pagination is bounded, repeated cursors are rejected, and every page is validated.
Deployment IDs must contain only ASCII letters, digits, underscores, and hyphens within the fixed
length bound. Every ID is checked against both tokens before use, and every dynamic deployment path
segment is URL encoded.

Immediately before each Create or Cancel request, the controller reads `/v9/projects/{projectId}`
through the configured team scope. The validated project ID, name, and account ID must match the
configured project and team, including after a long deployment poll.

If an exact deployment is ready, it is reused. An exact queued, initializing, or building
deployment is polled rather than duplicated. If no such deployment exists, the controller calls
Vercel's Create Deployment endpoint with the linked GitHub repository ID, exact branch ref, and
exact SHA. `target` is omitted so Vercel selects the Preview environment. Namespaced metadata
repeats the repository, pull request, branch, SHA, workflow run ID, and reason so later runs can
identify the deployment without guessing. `forceNew=1` is used only when a new reconciliation has
already observed an exact terminal failed deployment. Create, detail, and cancel responses must
prove deployment ID, project ID, null Preview target, state, and Orbit metadata. The workflow polls
the created deployment immediately and then through at most 240 five-second sleeps plus one final
GET to a ready or terminal state, requiring a nonempty final URL. After every active detail, the
polling owner refetches the pull request. If the same exact identity is now ineligible, it cancels
only that deployment and returns a canceled result. If only the SHA changed for the same head ref
and pull request identity, it cancels the superseded active deployment. Other identity changes
return a stale result without canceling. The 23-minute controller deadline may stop this sequence
earlier.

Create Deployment has no idempotency key. After a network error, timeout, 429, 5xx, 409, or an
unparseable success response, the controller marks the one POST as attempted and performs only a
short bounded exact-list observation. A newly visible ready or active deployment is reused; a
terminal deployment or no visible new deployment fails the workflow. The same reconciliation never
sends a second create request.

When current pull request state is ineligible, active deployments associated with that pull
request are canceled through Vercel's cancel endpoint. The filter requires the configured project,
null Preview target, repository ID, pull request number, and branch ref before cancellation. Ready,
failed, and canceled deployments are left unchanged. Live pull request identity and ineligibility
are refetched immediately before every individual cancellation mutation. A 400 or ambiguous cancel
response is followed by one validated detail read so a normal transition to a terminal state is not
mistaken for an unsafe retry.

## Fork policy

The token-backed workflow never creates a deployment for a fork. This preserves the security
boundary Vercel documents for Git Fork Protection: unreviewed fork code must not automatically
receive Preview environment variables or OIDC authority.

Fork previews remain a manual maintainer decision. A maintainer can use Vercel's explicit Git
reference deployment flow after reviewing the code, or deploy into a separate Preview project
whose environment has no sensitive values. The `preview` label does not authorize a fork in this
change. Automating fork previews requires a separate design for a credential-free project and an
auditable maintainer approval signal.

## Labels

`preview` and `no-preview` become fixed entries in `scripts/labels.ts`. This makes the documented
controls available in GitHub and prevents `scripts/sync-labels.ts --prune` from deleting them.

- `preview`: build a Preview for an otherwise eligible draft after CI succeeds.
- `no-preview`: suppress Preview creation and cancel an active Preview build.

## Setup and operations

The repository requires these GitHub Actions settings:

- Secret `VERCEL_TOKEN`, scoped to the team that owns the Orbit project.
- Variable `VERCEL_TEAM_ID`.
- Variable `VERCEL_PROJECT_ID`.
- Variable `VERCEL_PROJECT_NAME`, currently `orbit`.

After the new flow is merged, the old `BUILD_GATE_GITHUB_TOKEN`,
`BUILD_GATE_WATCH_PATHS`, `BUILD_GATE_READY_LABEL`, and `BUILD_GATE_BLOCK_LABEL` values should be
removed from Vercel. Git Fork Protection stays enabled.

The workflow is defined by the default branch, so pull request 341 can prove its controller and
workflow structure locally but cannot exercise the new privileged event path until the workflow
has landed on `main`. The first same-repository test pull request after merge is the production
canary. It starts as a web-impacting draft with no Preview, applies `preview` and waits for exact-head
CI plus one Preview, then removes the label or applies `no-preview` to prove active cancellation
by the polling owner without deleting a ready URL. A new ready head proves exact-SHA behavior.
Separate docs-only and fork cases prove that neither receives an automatic Preview.

## Tests

Shared validator tests cover accepted payloads and rejection of missing identifiers, invalid SHAs,
unknown states, malformed pagination, malformed rename history, and unsafe deployment IDs.

Controller tests use injected fetch and delay functions. They cover ready and draft policy,
control-label precedence, state transitions, CI success for the exact SHA, stale events, closed
pull requests, fork refusal, relevant and irrelevant paths, GitHub pagination, Vercel pagination,
existing active and ready deployments, exact project and Preview identity, one exact create,
poll-owner cancellation and head drift, post-CI state races, ambiguous create observation, active
cancellation races, bounded retries, real abort timeouts, network and body-read failures, invalid
JSON, invalid response shapes, token-safe results, and missing settings.

Repository checks cover the branch deployment map, the managed labels, removal of the old ignored
command and token references, discovery of the script tests by the root test command, and the two
source-policy checks that hosted CI previously omitted from `bun run verify`.

## Out of scope

Automatic fork previews, a new credential-free Vercel project, deletion of completed previews,
promotion of a Preview to production, application database migrations, and changes to the main
production deployment path are outside this change.
