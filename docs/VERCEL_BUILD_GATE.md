# Vercel build gate

Preview deployments only build once a pull request is marked **Ready for review**.
Production always builds.

## Why the gate exists

Orbit ran **700 deployments in the 22 days** after the project was created on
2026-07-28, peaking at 131 in a single day, and 77% of them were previews.
Across the team, 81% of 4,393 deployments in the 90 days to 2026-08-19 were
previews, and builds were $110 of the $506.93 August invoice.

## How it works

`apps/web/vercel.json` points Vercel's Ignored Build Step at
`scripts/vercel-build-gate.sh`.

**Exit codes are inverted from intuition: `exit 0` skips the build, `exit 1` runs it.**

Decision order:

| Condition | Result |
|---|---|
| `VERCEL_ENV=production` | build |
| system environment variables not exposed | build |
| branch has no open PR | skip |
| PR labelled `no-preview` | skip |
| PR labelled `preview` | build (even while draft) |
| PR is a draft | skip |
| PR is ready for review | build, subject to the path filter |
| nothing changed under `BUILD_GATE_WATCH_PATHS` | skip |

Every failure path - missing token, GitHub API error, unparseable response,
unreachable diff base - **builds**. The gate never silently withholds a
deployment because something broke.

The metadata check has to come before the pull request check, and the order is
load-bearing. `VERCEL_GIT_PULL_REQUEST_ID` is empty both when a branch genuinely
has no pull request *and* when system environment variables are not exposed at
all. Testing the PR id first would read the second case as the first and skip
every preview in the project, silently, which is the one behaviour this gate
must never have. `VERCEL_GIT_REPO_OWNER` and `VERCEL_GIT_REPO_SLUG` are set
whenever the variables are exposed, regardless of pull request state, so they
are what distinguishes the two.

## The button

Open the PR as a **draft** while you work. Commits accumulate with zero builds.
When you want a preview, click **Ready for review** - that is the button. Adding
the `preview` label also works if you want previews while staying in draft.

## Setup per project

1. Project Settings → Environment Variables → tick **Enable access to System
   Environment Variables**. The gate needs `VERCEL_GIT_PULL_REQUEST_ID`,
   `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG` and `VERCEL_GIT_PREVIOUS_SHA`.
   Note that `VERCEL_GIT_PREVIOUS_SHA` is *only* exposed when an Ignored Build
   Step is configured.
2. Add `BUILD_GATE_GITHUB_TOKEN` - a fine-grained token with **Pull requests:
   read** on the repo. Without it the gate fails open and every push builds.
3. Optionally add `BUILD_GATE_WATCH_PATHS` (space separated, repo-relative) to
   skip builds when nothing under those paths changed.

## Monorepo path filtering

This repo holds two apps. Only `apps/web` is deployed to Vercel, so a push that
only touches `apps/realtime` has nothing to preview. `apps/web/vercel.json`
therefore supplies a default:

```
BUILD_GATE_WATCH_PATHS="apps/web packages package.json bun.lock"
```

Setting the variable in project settings overrides that default.

Watch paths are **repo-relative**, and the script resolves them against
`git rev-parse --show-toplevel` rather than the working directory. This matters:
Vercel runs the Ignored Build Step from the project's **Root Directory**, so for
a project rooted at `apps/web` a plain `git diff -- apps/web` looks for
`apps/web/apps/web`, finds nothing, and skips every build. Test any change to
this script from a subdirectory, not just from the repo root.

The diff base is `VERCEL_GIT_PREVIOUS_SHA`, the last **successfully deployed**
commit - not `HEAD^`. `HEAD^` is wrong whenever more than one commit lands at
once, which is the normal case for a squash merge or a batch of pushes. If that
SHA is missing from Vercel's shallow clone the gate builds rather than guessing.

## Testing changes to the gate

The script shells out to `curl` and `git`, so it is testable by putting a stub
`curl` earlier on `PATH`. See the harness used when this landed - it covers
production, draft, ready, both labels, a missing token, API failure, malformed
JSON, and the path filter against real git history.
