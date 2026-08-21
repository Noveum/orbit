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
| Fork | any state or labels | never eligible for an automatic Preview |

An eligible pull request must also target `main`, come from the same repository,
and change at least one web-impacting path:

- `apps/web/**`
- `packages/**`
- `package.json`
- `bun.lock`
- `tsconfig.base.json`

Ready status or the `preview` label does not establish trust. The controller
also proves that the newest `CI` run belongs to the current head SHA, is
associated with the same pull request and current `main`, and completed
successfully. A state event can create a Preview immediately when that proof
already exists. Otherwise the successful `workflow_run` event reconciles the
pull request after CI finishes. A later non-green run blocks an older success.

## Trust boundary

`Vercel Preview` is a privileged default-branch workflow. It checks out
`${{ github.sha }}`, which is the trusted base or default-branch commit for its
three event types. It never selects, fetches, installs, caches, downloads an
artifact from, builds, or executes pull request code. Dependency lifecycle
scripts are disabled. The only operational command is
`bun scripts/vercel-preview-deploy.ts`, and `VERCEL_TOKEN` exists only on that
step.

Only the trusted GitHub controller is isolated from pull request code. The
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

1. Vercel v7 lists Preview deployments by team, project, branch, and, when
   creating, exact head SHA.
2. Vercel v13 creates or reads a deployment with the same-repository GitHub
   repository ID, head ref, exact head SHA, and Orbit metadata. It omits a
   target so Vercel uses the project's Preview environment.
3. Vercel v12 cancels matching active deployments.

`QUEUED`, `INITIALIZING`, and `BUILDING` deployments are active. Making a pull
request ineligible by closing it, converting it to draft without `preview`,
removing `preview` from an otherwise ineligible draft, or adding `no-preview`
cancels matching active Preview work. A deployment that is already `READY` is
not canceled, so its ready URL remains available.

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
3. Open a same-repository, web-impacting draft. Confirm that it gets no Preview,
   apply `preview`, let CI succeed for that exact head, and confirm a Preview is
   created only then.
4. Remove `preview` while it is still required, or add `no-preview`. Confirm
   matching active work is canceled and an already ready URL remains.
5. Make the pull request ready, push a new relevant head, and confirm only that
   exact SHA deploys after its CI succeeds.
6. Repeat with a docs-only change and with a fork. Confirm neither receives an
   automatic Preview.
