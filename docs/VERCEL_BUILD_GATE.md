# Vercel Preview deployment gate

Orbit creates Vercel Preview deployments only after the exact pull request head
has passed CI and still satisfies the repository policy. Production deployments
from `main` remain enabled through the Vercel Git integration.

## Eligibility

The controller evaluates the current pull request from GitHub on every event.
`no-preview` takes precedence over every other state.

| Pull request state | Labels | Result after exact-head CI succeeds |
| --- | --- | --- |
| Ready for review | neither managed label | eligible |
| Ready for review | `preview` | eligible |
| Ready for review | `no-preview`, with or without `preview` | ineligible |
| Draft | `preview` without `no-preview` | eligible |
| Draft | neither managed label | ineligible |
| Draft | `no-preview`, with or without `preview` | ineligible |
| Closed | any labels | ineligible |
| Fork or Dependabot | any state or labels | never eligible for an automatic Preview |

An eligible pull request must also target `main`, come from the same repository,
not be authored by Dependabot, and change at least one web-impacting path:

- `apps/web/**`
- `packages/**`
- `package.json`
- `bun.lock`
- `tsconfig.base.json`

For a renamed file, either the current filename or GitHub's validated
`previous_filename` can make the change web-impacting. Moving code out of
`apps/web/**` or `packages/**` therefore still requires a Preview.

Ready status or the `preview` label does not establish trust. The controller
also proves that the newest `CI` run belongs to the current head SHA, is
associated with the same pull request and current `main`, and completed
successfully. A state event can create a Preview immediately when that proof
already exists. Otherwise the successful `workflow_run` event reconciles the
pull request after CI finishes. A later non-green run blocks an older success.
Before Create, the controller repeats the CI proof and then refetches the pull
request once more. Any head, identity, state, draft, or label change during that
proof prevents the POST.

## Trust boundary

`Vercel Preview` is a privileged default-branch workflow. It checks out
`${{ github.sha }}`, which is the trusted base or default-branch commit for its
three event types. It never selects, fetches, installs, caches, downloads an
artifact from, builds, or executes pull request code. Dependency lifecycle
scripts are disabled. The only operational command is
`bun scripts/vercel-preview-deploy.ts`, and `VERCEL_TOKEN` exists only on that
step.

Only the trusted GitHub controller is isolated from pull request code. A
successful `workflow_run` can receive Actions secrets even when Dependabot's
source CI run could not, so the controller treats a Dependabot pull request as
fork-equivalent before any Vercel request. The
API-created Vercel Preview still builds same-repository pull request code with
the project Preview environment scope. Git Fork Protection must remain enabled,
and forks are rejected by the controller, but maintainers must still treat the
Preview environment as available to same-repository pull request code.

The `git.deploymentEnabled` map in `apps/web/vercel.json` disables automatic Git
deployments for `**` and enables them for `main`. This is a repository-controlled
cost policy, not a security boundary. A repository change can alter that policy,
so security depends on the trusted workflow and controller validation.

Each API create remains a Vercel deployment. Canceled attempts and reused
deployments can remain visible in Vercel deployment history and counts. The gate
reduces unnecessary creation, but it does not promise that an ignored or
canceled attempt is free.

## Reconciliation and Vercel API behavior

The controller uses one deployment path:

1. Vercel v7 lists Preview deployments by team, project, and branch before CI
   to find active work from prior heads. It lists by exact head SHA again when
   creating or reusing current-head work.
2. Vercel v9 validates the configured project before every mutation preflight.
   The validated project ID, name, and account ID must match the configured
   project and team. Create then re-proves CI, refreshes the pull request, and
   re-reads `main`. Cancel refreshes its path-specific intent before the PATCH.
3. Vercel v13 creates or reads a deployment with the same-repository GitHub
   repository ID, head ref, exact head SHA, and Orbit metadata. It omits a
   target so Vercel uses the project's Preview environment.
4. Vercel v12 cancels matching active deployments.

Deployment IDs are accepted only when they contain ASCII letters, digits,
underscores, and hyphens within the controller's fixed bound. The controller
checks IDs and URLs against both tokens before they can enter a result, and URL
encodes every deployment ID used as an API path segment.

`QUEUED`, `INITIALIZING`, and `BUILDING` deployments are active. Making a pull
request ineligible by closing it, converting it to draft without `preview`,
removing `preview` from an otherwise ineligible draft, or adding `no-preview`
cancels matching active Preview work. A deployment that is already `READY` is
not canceled, so its ready URL remains available.

Per-pull-request workflow runs remain serialized with in-progress cancellation
disabled. While the owner polls a queued, initializing, or building deployment,
it refetches the current pull request after every active detail response. If the
same exact head becomes closed or ineligible, that owner cancels only its exact
deployment and returns a canceled result. If only the head SHA changed while the
pull request, repositories, base, and head ref remain identical, the old owner
cancels its superseded active deployment. Any other identity change returns a
stale event without mutation.

`pull_request_target` includes `synchronize`, so a pushed head immediately runs
the trusted controller. Every trusted current-candidate reconciliation also
sweeps active prior-head work before checking current-head CI. A candidate for
cancellation must have a different valid 40-character hexadecimal SHA and exact
configured project, repository ID, pull request number, and head ref metadata.
This repeated sweep lets later CI and repository-dispatch events recover after a
transient synchronize failure or an interrupted polling owner. READY prior-head
deployments are retained, so their URLs remain available.

Events for stale heads cannot create or cancel work for the current head. An
existing exact ready or active deployment is reused. Terminal deployment
history can cause one forced create for the exact head, using the same v13
endpoint rather than an alternate build path.

## Repository and Vercel setup

The GitHub repository must provide:

- Secret `VERCEL_TOKEN`
- Variable `VERCEL_TEAM_ID`
- Variable `VERCEL_PROJECT_ID`
- Variable `VERCEL_PROJECT_NAME`

Keep Vercel Git Fork Protection enabled. Synchronize the managed `preview` and
`no-preview` labels with the rest of the repository labels:

```bash
bun run labels:sync
bun run labels:sync --apply
```

The first command is a dry run. Review its plan before applying it.

After `.github/workflows/vercel-preview.yml` is present on `main`, remove these
legacy Vercel environment values:

- `BUILD_GATE_GITHUB_TOKEN`
- `BUILD_GATE_WATCH_PATHS`
- `BUILD_GATE_READY_LABEL`
- `BUILD_GATE_BLOCK_LABEL`

They belonged to the removed Ignored Build Step and are not read by the trusted
controller.

## Manual recovery

A maintainer can reconcile a positive numeric pull request number with an
authenticated repository dispatch:

```bash
gh api repos/Noveum/orbit/dispatches \
  --method POST \
  -f event_type=vercel-preview-reconcile \
  -F 'client_payload[pull_request]=341'
```

The event type must be `vercel-preview-reconcile`, and
`client_payload.pull_request` must be a positive number. The event shares the
same per-pull-request concurrency group as state and CI events. Malformed input
can form an unused group but is rejected before any Vercel call.

Do not add or use `workflow_dispatch` for recovery. A caller can select a
non-default ref for that trigger. GitHub runs `repository_dispatch` from the
last commit on the default branch, preserving the controller trust boundary.

## Post-merge canary

Run this procedure only after the workflow exists on `main`:

1. Confirm Vercel Git Fork Protection is enabled. Configure `VERCEL_TOKEN` and
   the `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_PROJECT_NAME`
   repository variables.
2. Remove the four legacy values only after the workflow is on `main`.
3. Open a same-repository, web-impacting draft at head A. Confirm it gets no
   Preview, apply `preview`, let CI succeed for exact head A, and wait for its
   deployment to reach `READY`. Record and retain head A's ready URL.
4. Keep `preview` applied and push a web-impacting head B. Let exact-head CI
   succeed and wait until B's deployment is `QUEUED`, `INITIALIZING`, or
   `BUILDING`. Apply `no-preview`. Confirm the polling owner observes the new
   live state and cancels the deployment whose metadata names head B before it
   reaches `READY`, while head A's recorded ready URL remains available.
5. Keep `no-preview` applied, make the pull request ready for review, and push a
   web-impacting head C. Let exact-head CI succeed and confirm no deployment is
   created for C while the label remains. Remove `no-preview`, then confirm a
   deployment is created for exact head C. Confirm no new deployment is created
   for head B and no SHA other than C is selected by this reconciliation.
6. Open a ready same-repository pull request with only a docs change, let its
   exact-head CI succeed, and confirm it receives no automatic Preview.
7. Open a ready fork pull request with a web-impacting change, let its exact-head
   CI succeed, and confirm it receives no automatic Preview. Repeat with a
   Dependabot pull request if dependency updates are enabled.
