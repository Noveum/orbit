# The GitHub App

Orbit talks to GitHub through a GitHub App, not a personal token. A workspace
owner installs it, picks repositories, and Orbit exchanges the installation for a
short lived token each time it needs one.

## Permissions the App needs today

**Repository permissions**

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read-only | Mandatory for every GitHub App, and required by `GET /installation/repositories`, which is how the connect flow lists what you may associate. |

That is the whole list. Nothing else is used.

**Organization permissions:** none.

**Account permissions:** none.

**Subscribe to events**

| Event | Why |
| --- | --- |
| Repository | A repository being renamed, transferred, archived, made private or public, or deleted has to be reflected against the association Orbit stores, or a project ends up pointing at a repository that no longer answers to that name. |

`installation` and `installation_repositories` are delivered to every App without
being subscribed to, and Orbit handles both, so they do not appear in that list.

## Why nothing else

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
`GET /installation/repositories` consumes a permission, and Metadata covers it.

There are exactly two `POST` requests in the integration and both are token
exchanges. Orbit does not write to a repository, does not read file contents,
does not read or write issues or pull requests, and does not read members. If the
App is currently granted any of that, it is granting more than the code can use.

`bun run check-bun-imports` and the rest of `verify` will not catch an
over-permissioned App, so this file is the record. Keep it level with the code.

## What pull request tracking will add

Tracking pull requests against issues is not built yet. When it lands it will
need, and this file should be updated at the same time:

| Permission | Access | Why |
| --- | --- | --- |
| Pull requests | Read-only | Read a pull request's state, reviews and merge status. |
| Checks | Read-only | Report a failing check onto the issue. |
| Contents | Read-only | Resolve the branch behind a pull request. |

with `pull_request`, `pull_request_review`, `check_suite` and `issue_comment`
added to the subscribed events. Still nothing that writes.

## Webhook secret

The webhook secret is set on the App and in the deployment environment as
`GITHUB_APP_WEBHOOK_SECRET`. Both have to change together: rotate on the App
first, update the environment, then redeploy, because Vercel does not apply an
environment change to a deployment that already exists. Between those two steps
every delivery fails signature verification and GitHub retries, so do it in one
sitting rather than leaving it half done.
