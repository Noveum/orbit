# The GitHub App

Orbit talks to GitHub through a GitHub App, not a personal token. A workspace
owner installs it, picks repositories, and Orbit exchanges the installation for a
short lived token each time it needs one.

## Permissions the App needs

**Repository permissions**

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read-only | Mandatory for every GitHub App, and required by `GET /installation/repositories`, which is how the connect flow lists what you may associate. |
| Pull requests | Read-only | Required to subscribe to `pull_request` and `pull_request_review`. Those events are what link a pull request to an issue, move the issue as the pull request opens, merges or closes, and raise a review request. |
| Checks | Read-only | Required to subscribe to `check_suite`, which is what reports a failing run onto the issue. |

**Organization permissions:** none.

**Account permissions:** none.

**Subscribe to events**

| Event | What it drives |
| --- | --- |
| Repository | A rename, transfer, archive, visibility change or delete has to be reflected against the association Orbit stores, or a project ends up pointing at a repository that no longer answers to that name. |
| Pull request | Linking a pull request to the issues it names, and moving the issue as it opens, merges or closes. |
| Pull request review | Review requested, and review submitted or approved. |
| Check suite | A failing suite reported onto the linked issue. |

`installation` and `installation_repositories` are delivered to every App without
being subscribed to, and Orbit handles both, so they are not in that list.

Orbit does **not** handle `check_run`, `workflow_run`, `workflow_job`, `status`,
`push`, `repository_dispatch` or `pull_request_review_comment`. Production has
received thousands of those and every one was accepted and discarded. Leaving
them subscribed costs delivery volume and nothing else, but there is no reason
to subscribe to them.

## Why nothing more than read

Every call the App makes is one of these five, and no other:

```
POST /app/installations/{id}/access_tokens   mint an installation token
GET  /app/installations/{id}                 read the installation back
GET  /installation/repositories              list what was installed on
POST /login/oauth/access_token               exchange the OAuth code
GET  /user/installations                     the installations this user can see
```

The first two authenticate as the App itself with a JWT and need no permission
grant. The last two are the OAuth leg and run as the signing-in user. Only
`GET /installation/repositories` consumes a permission on the outbound side, and
Metadata covers it. Pull requests and Checks are needed for the **inbound**
direction: GitHub will not deliver an event whose permission the App does not
hold.

There are exactly two `POST` requests in the integration and both are token
exchanges. Orbit does not write to a repository, does not read file contents,
does not create or edit issues or pull requests on GitHub, and does not read
members. Read-only throughout is enough.

`bun run verify` cannot catch an over-permissioned App, so this file is the
record. Keep it level with the code: if a new event name appears in
`packages/services/src/github`, the permission that carries it belongs here.

## How a pull request finds its issue

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

Associating a repository with a project is organisational. Its load bearing
effect is that it calls `reconcileWatchedRepositories`, and being in the watch
list is what lets events through at all. Unlinking the last association stops
the repository being watched.

## Webhook secret

The webhook route reads `GITHUB_WEBHOOK_SECRET`. That is the name to set in the
deployment environment, and it has to match what the App is configured with.

Rotate in this order: change it on the App, update
`GITHUB_WEBHOOK_SECRET` in the environment, then redeploy. Vercel does not apply
an environment change to a deployment that already exists, so skipping the
redeploy leaves every delivery failing signature verification with a `401` while
GitHub retries. Do it in one sitting.
