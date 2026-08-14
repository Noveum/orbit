# The GitHub App

Orbit talks to GitHub through a GitHub App, not a personal token. A workspace
owner installs it, picks repositories, and Orbit exchanges the installation for a
short lived token each time it needs one.

## Permissions the App needs

**Repository permissions**

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read-only | Mandatory for every GitHub App, and required by `GET /installation/repositories`, which is how the connect flow lists what you may associate. |
| Pull requests | Read-only | Delivers pull request lifecycle, review, inline comment and review thread events. It also lets Orbit backfill reviews and inline comments. |
| Issues | Read-only | Delivers and backfills conversation comments on pull requests. GitHub exposes these through its Issues API even though Orbit does not import GitHub issues. |
| Checks | Read-only | Delivers check suites and individual check runs, and lets Orbit backfill the current runs for a pull request head commit. |
| Commit statuses | Read-only | Delivers commit status updates from CI providers that use statuses rather than check runs. |
| Actions | Read-only | Delivers workflow run updates, including runs whose check suite payload does not identify a pull request. |

**Organization permissions:** none.

**Account permissions:** none.

**Subscribe to events**

| Event | What it drives |
| --- | --- |
| Repository | A rename, transfer, archive, visibility change or delete has to be reflected against the association Orbit stores, or a project ends up pointing at a repository that no longer answers to that name. |
| Pull request | Linking a pull request to the issues it names, and moving the issue as it opens, merges or closes. |
| Pull request review | Review requested, and review submitted or approved. |
| Pull request review comment | Inline diff comments and their exact code location. |
| Pull request review thread | Review thread resolution and reopening. |
| Issue comment | Conversation comments, only when the issue payload identifies a pull request. |
| Check suite | Aggregate CI state. |
| Check run | Individual CI checks, their state and their GitHub destination. |
| Status | CI providers that publish commit statuses. |
| Workflow run | GitHub Actions workflow state. |

`installation` and `installation_repositories` are delivered to every App without
being subscribed to, and Orbit handles both, so they are not in that list.

Orbit does not handle `workflow_job`, `push` or `repository_dispatch`. Do not
subscribe to those events until a product path consumes them.

## Why nothing more than read

The App makes only token, installation and read calls:

```text
POST /app/installations/{id}/access_tokens   mint an installation token
GET  /app/installations/{id}                 read the installation back
GET  /installation/repositories              list what was installed on
POST /login/oauth/access_token               exchange the OAuth code
GET  /user/installations                     the installations this user can see
GET  /repos/{owner}/{repo}/pulls              import open pull requests
GET  /repos/{owner}/{repo}/issues/{n}/comments backfill PR conversation comments
GET  /repos/{owner}/{repo}/pulls/{n}/reviews  backfill submitted reviews
GET  /repos/{owner}/{repo}/pulls/{n}/comments backfill inline review comments
GET  /repos/{owner}/{repo}/commits/{sha}/check-runs backfill current checks
GET  /repos/{owner}/{repo}/commits/{sha}/statuses backfill commit statuses
```

The App JWT covers installation discovery and token minting. Repository reads
use a short lived installation token and consume only the read permissions in
the table above. The OAuth calls prove that the person connecting the App can
see the installation they selected.

The only `POST` requests are token exchanges. Orbit does not write to a
repository, read file contents, create or edit GitHub issues, comment, approve,
merge, or read organization members. Read-only throughout is enough for the
current experience.

`bun run verify` cannot catch an over-permissioned App, so this file is the
record. Keep it level with the code: if a new event name appears in
`packages/services/src/github`, the permission that carries it belongs here.

## Pull request mirror and optional Orbit links

Every open pull request in a watched repository is stored as a first-class
`github_pull_request`, whether it names Orbit work or not. Webhooks maintain its
state and append normalized lifecycle, review, comment, review thread and check
records to `github_pull_request_activity`. Opening a pull request in Orbit also
backfills the comment, review and check history from GitHub so a missed webhook
does not leave the activity view permanently incomplete.

Repository refreshes backfill watched repositories in bounded batches and save
progress on `github_repository_sync`. Pull request detail refreshes use a short
database lease so concurrent tabs do not duplicate the same GitHub API work.
Webhook deliveries use a separate claim timestamp from their original receipt
time, and an active claim returns a non-success response instead of silently
acknowledging work that has not finished.

Matching is by issue identifier, and the repository's project association plays
no part in it. `applyGithubEvent` looks the repository up in the watch list,
takes the organization from that row, and resolves identifiers against the whole
workspace. A pull request in any watched repository links to any issue it names.

Three places are read, and they are not read the same way:

- **Branch name** and **title** match a bare identifier, because both are short
  and written deliberately by the person doing the work. `copy_branch_name`
  produces `user/eng-3-slug`, which links itself.
- **Description** needs a linking keyword in front of the identifier: close,
  closes, closed, fix, fixes, fixed, resolve, resolves, resolved, ref, refs,
  part of, relates to, related to. Fenced blocks, inline code, HTML comments and
  quoted lines are stripped before scanning, so a template carrying
  `<!-- Fixes ENG-123 -->` as its example links nothing.

Associating a repository with a project is organizational. Its load bearing
effect is that it calls `reconcileWatchedRepositories`, and being in the watch
list is what lets events through at all. Unlinking the last association stops
the repository being watched.

The Pull requests page is visible to current workspace members. Linked task and
project context is filtered independently through current team membership, so
a person can still see a workspace PR without gaining access to private task
metadata. Unlinked notifications go only to a mapped PR author or requested
reviewer who is still a member of the workspace.

## Webhook secret

The webhook route reads `GITHUB_WEBHOOK_SECRET`. That is the name to set in the
deployment environment, and it has to match what the App is configured with.

Rotate in this order: change it on the App, update
`GITHUB_WEBHOOK_SECRET` in the environment, then redeploy. Vercel does not apply
an environment change to a deployment that already exists, so skipping the
redeploy leaves every delivery failing signature verification with a `401` while
GitHub retries. Do it in one sitting.

## Production rollout

Run the committed migrations before directing webhook traffic to a deployment
that contains this integration. An existing database that needs the idempotent
repair path can run:

```bash
bun run db:catchup packages/db/catchup/github-pull-request-mirror.sql
bun run db:catchup packages/db/catchup/github-notification-external-url.sql
bun run db:catchup packages/db/catchup/github-delivery-and-refresh-claims.sql
bun run db:check-drift
```

The Vercel function serving `/api/webhooks/github` has a 60 second maximum
duration. The delivery claim lease is slightly longer so a second delivery does
not take over while the first function is still allowed to run.
