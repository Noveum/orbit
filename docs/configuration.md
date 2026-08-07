# Configuration

Every setting is an environment variable. `.env.example` is a working local
configuration, so copy it and change what you need:

```bash
cp .env.example .env
```

Orbit parses its own environment with Zod at startup, so a missing or malformed
required variable fails immediately with a message that names it, rather than
failing later somewhere confusing.

Bun does not implement `process.loadEnvFile`, so scripts load the repository
`.env` with `bun --env-file=../../.env` in the script itself. A script whose
working directory is inside a workspace package will not see the repository
`.env` without that flag.

## Required

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://orbit:orbit@localhost:5434/orbit` | Postgres 16 or newer. In production use a pooled connection string |
| `REDIS_URL` | `redis://localhost:6380` | Redis 7 or newer. Carries realtime fan-out. Use `rediss://` for TLS |
| `BETTER_AUTH_SECRET` | 32+ random characters | Signs sessions. `openssl rand -base64 32`. Never reuse the example value |
| `BETTER_AUTH_URL` | `https://orbit.example.com` | Must match the origin exactly, or sign-in loops |
| `NEXT_PUBLIC_APP_URL` | `https://orbit.example.com` | Public origin. Used for absolute links in email and OAuth metadata |

## Realtime

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_REALTIME_URL` | unset | **Local development only.** Set it to `ws://localhost:3100` locally |
| `REALTIME_PORT` | `3100` | Port for `apps/realtime`, which is never deployed |

`NEXT_PUBLIC_REALTIME_URL` is ignored whenever `NODE_ENV` is `production`, where
the socket is always served from the page's own origin at `/api/ws`. Setting it
on a deployed environment does nothing useful and risks confusing whoever reads
the config next, so leave it unset there.

## Authentication

Orbit uses [better-auth](https://better-auth.com). Passkeys and magic links work
with no configuration beyond email. The rest are optional.

| Variable | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Redirect URI is `<app>/api/auth/callback/google` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in. Callback is `<app>/api/auth/callback/github` |
| `ORBIT_PASSWORD_AUTH` | `false` by default. `true` enables email and password |
| `ALLOWED_EMAIL_DOMAINS` | Comma separated. Empty means no restriction |
| `ORBIT_DEV_LOGIN` | **Local only.** One-click sign-in as any seeded user |

Email and password is off by default and hashed with `@node-rs/argon2`
(argon2id) when on. It is rate limited, and it is never a replacement for the
passwordless methods. Leave it off unless you have a reason.

`ALLOWED_EMAIL_DOMAINS` is enforced both on invite creation and on user
creation, so it covers every provider rather than just invites. A workspace can
narrow it further with its own `allowedEmailDomains` setting.

```bash
ALLOWED_EMAIL_DOMAINS=example.com,example.org
```

**`ORBIT_DEV_LOGIN` must never be set on a deployed environment.** It lists the
seeded users on the login screen and signs anyone in as any of them.

## Email

Orbit sends through [Resend](https://resend.com) only, for magic links, invites
and notification digests.

| Variable | Notes |
| --- | --- |
| `RESEND_API_KEY` | From the Resend dashboard |
| `EMAIL_FROM` | Must be on a domain verified in Resend |

```bash
RESEND_API_KEY=re_xxxxxxxxx
EMAIL_FROM="Orbit <orbit@example.com>"
```

If `EMAIL_FROM` is not on a verified domain every send fails, and the only
symptom users see is that invites never arrive.

## Object storage

Any S3-compatible bucket. Uploads go straight from the browser through a
presigned PUT.

| Variable | Local value | Notes |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9010` | MinIO locally, R2 or S3 in production |
| `S3_REGION` | `us-east-1` | `auto` for Cloudflare R2 |
| `S3_BUCKET` | `orbit-uploads` | |
| `S3_ACCESS_KEY_ID` | `orbitminio` | |
| `S3_SECRET_ACCESS_KEY` | `orbitminio` | |

The bucket needs a CORS policy allowing your origin, otherwise uploads fail in
the browser while the server logs look healthy. `infra/s3-cors.json` is the
document, with the origin as a placeholder.

## Integrations

| Variable | Notes |
| --- | --- |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack OAuth |
| `SLACK_SIGNING_SECRET` | Verifies inbound Slack requests |
| `GITHUB_APP_ID` | GitHub App, for linking pull requests to issues |
| `GITHUB_APP_PRIVATE_KEY` | The PEM. Escaped newlines as `\n` are handled |
| `GITHUB_APP_SLUG` | The app's URL slug. Without it, the connect button hides |
| `GITHUB_WEBHOOK_SECRET` | Verifies inbound webhooks |

All optional. Orbit hides the affordance when an integration is not configured
rather than showing a button that fails. See [Integrations](integrations.md).

## MCP

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_MCP_URL` | Overrides the advertised MCP URL. Defaults to `<app>/mcp` |

You almost never need this. It exists for deployments that put the MCP endpoint
behind a different hostname. See [MCP server](mcp.md).

## Testing

| Variable | Notes |
| --- | --- |
| `ORBIT_TEST_LANE` | Isolates a test run into its own set of databases |
| `ORBIT_E2E_BASE_URL` | Where Playwright points. Defaults to `NEXT_PUBLIC_APP_URL` |

`ORBIT_TEST_LANE` matters whenever two runs share a Postgres, which happens with
two worktrees or two agents. Without it both runs truncate the same tables and
you get deadlocks and foreign key violations that look like real failures.

```bash
ORBIT_TEST_LANE=my-branch bun run test
bun run db:test-lanes-drop
```

The lane name becomes a readable stub plus a digest of the raw value, so two
lanes that normalise alike stay apart.

## Reference: a production environment

```bash
DATABASE_URL=postgres://user:pass@db.example.com:6543/orbit
REDIS_URL=rediss://default:pass@redis.example.com:6379

BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://orbit.example.com
NEXT_PUBLIC_APP_URL=https://orbit.example.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

ALLOWED_EMAIL_DOMAINS=example.com

RESEND_API_KEY=re_...
EMAIL_FROM="Orbit <orbit@example.com>"

S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=orbit-uploads
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Note what is absent: no `NEXT_PUBLIC_REALTIME_URL`, and no `ORBIT_DEV_LOGIN`.
