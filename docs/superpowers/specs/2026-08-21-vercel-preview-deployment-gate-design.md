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
not delete completed previews.

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

The repository removes `scripts/vercel-build-gate.sh` and its tests. No secret is made available to
code from a pull request checkout, and the gate no longer depends on Vercel system environment
variables or an ignored-build exit-code convention.

## Trusted workflow

`.github/workflows/vercel-preview.yml` runs from the default branch through three trusted event
paths:

- `pull_request_target` handles `opened`, `reopened`, `ready_for_review`,
  `converted_to_draft`, `labeled`, and `unlabeled` state transitions.
- `workflow_run` handles a completed `CI` workflow and proceeds only when the source event was a
  pull request and the conclusion was success.
- `workflow_dispatch` accepts a pull request number for maintainer recovery when an event was
  missed or a deployment needs to be retried.

The workflow checks out only the trusted workflow SHA from the default branch with persisted Git
credentials disabled. It never
fetches, checks out, installs, builds, caches, or executes the pull request head, and it never
downloads an artifact from the untrusted CI run. Pull request data appears only in environment
values and API request bodies, never as shell source.

Permissions are limited to `actions: read`, `contents: read`, and `pull-requests: read`. The Vercel
token is a GitHub Actions secret. Team ID, project ID, and project name are Actions variables.
Concurrency is keyed by pull request number when the event supplies one and does not cancel an
in-progress reconciler. Vercel metadata checks provide a second idempotency boundary. A rare
workflow-run payload without a pull request number uses its exact head SHA until the controller
resolves the pull request through GitHub.

## Controller and validation

`scripts/vercel-preview-deploy.ts` is the only executable controller. It imports Zod schemas from
`@orbit/shared/validators` and validates the GitHub event payload, every GitHub response, every
Vercel response, and configuration before using them.

The controller resolves one or more pull request numbers from the triggering event, then refetches
each pull request from GitHub. An event is stale when its recorded head SHA no longer equals the
live pull request head. Stale events are no-ops. Closed pull requests and fork heads are also
no-ops.

For a pull request state event or manual dispatch, the controller queries completed runs of
`.github/workflows/ci.yml` and requires a successful `pull_request` run for the exact head SHA. A
successful `workflow_run` event already supplies that fact, but the controller still verifies
that its head SHA matches the live pull request.

Changed files are read from the paginated pull request files endpoint. The web deployment is
affected when a filename is below `apps/web/` or `packages/`, or is exactly `package.json`,
`bun.lock`, or `tsconfig.base.json`. Configuration is fixed in trusted code rather than split
between Vercel and GitHub settings.

GitHub and Vercel requests have a finite timeout. Rate-limit and server failures use bounded
retries. Authentication failures, malformed payloads, exhausted pagination, and unsuccessful
mutations fail the workflow visibly. Logs never contain either token.

## Vercel API contract

Before mutation, the controller lists deployments for the configured project and filters them by
Preview target and metadata for repository ID, pull request number, branch ref, and commit SHA.
Pagination is bounded and every page is validated.

If an exact deployment is queued, initializing, building, or ready, deployment is a no-op. If no
such deployment exists, the controller calls Vercel's Create Deployment endpoint with the linked
GitHub repository ID, exact branch ref, and exact SHA. `target` is omitted so Vercel selects the
Preview environment. Metadata repeats the repository, pull request, branch, and SHA so later runs
can identify the deployment without guessing.

When current pull request state is ineligible, active deployments associated with that pull
request are canceled through Vercel's cancel endpoint. The filter requires the configured project,
Preview target, repository ID, pull request number, and branch ref before cancellation. Ready,
failed, and canceled deployments are left unchanged.

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
canary for Vercel Git metadata, the Preview URL, and label transitions.

## Tests

Shared validator tests cover accepted payloads and rejection of missing identifiers, invalid SHAs,
unknown states, and malformed pagination.

Controller tests use injected fetch and delay functions. They cover ready and draft policy,
control-label precedence, state transitions, CI success for the exact SHA, stale events, closed
pull requests, fork refusal, relevant and irrelevant paths, GitHub pagination, Vercel pagination,
existing active and ready deployments, one exact create, active cancellation, bounded retries,
timeouts, authentication failures, invalid JSON, invalid response shapes, and missing settings.

Repository checks cover the branch deployment map, the managed labels, removal of the old ignored
command and token references, and discovery of the script tests by the root test command.

## Out of scope

Automatic fork previews, a new credential-free Vercel project, deletion of completed previews,
promotion of a Preview to production, application database migrations, and changes to the main
production deployment path are outside this change.
