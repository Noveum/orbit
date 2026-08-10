# Troubleshooting

The failures we actually hit, and what causes each one. If you hit something
that is not here, please
[add it](https://github.com/Noveum/orbit/issues/new?template=documentation.yml).

## Setup

### `bun run verify` fails with connection errors

You skipped `bun run db:test-setup`. Each package tests against its own
database, and without them the suite cannot connect. The errors look like broken
tests rather than missing setup, which is what makes this one expensive.

```bash
bun run infra:up
bun run db:test-setup
```

### `bun: command not found`

```bash
curl -fsSL https://bun.sh/install | bash
```

Then open a new shell. Orbit needs 1.3 or newer, and `bun --version` will tell
you what you have.

### Docker containers will not start

```bash
docker ps -a
docker logs orbit-postgres
```

Usually a port is already taken. Postgres wants 5434, Redis 6380, MinIO 9010 and
9011. If a previous run left a volume in a bad state:

```bash
bun run infra:reset
bun run db:push && bun run db:test-setup && bun run db:seed
```

`infra:reset` destroys the data. That is fine locally, and never run it against
anything you care about.

### Port already in use

```bash
lsof -i :3000
```

A previous `bun run dev` that did not shut down cleanly is the usual cause. It
can also be a dev server from another worktree, which is easy to miss because
the app answers but serves a different checkout.

### A module cannot be resolved, but it is in `package.json`

The workspace symlinks are out of date. This happens after switching branches
that changed dependencies.

```bash
bun install
```

If that does not do it, delete `node_modules` and install again. The symptom is
a `Module not found` for a package that is clearly declared, and the dev server
returns 500 on every route while looking otherwise healthy.

## Signing in

### The login screen shows no users

Either `ORBIT_DEV_LOGIN=1` is missing from `.env`, or you have not seeded:

```bash
bun run db:seed
```

### Sign-in loops back to the login screen

`BETTER_AUTH_URL` does not exactly match the origin you are visiting. If you are
on `http://localhost:3000` it has to be exactly that, not `127.0.0.1`, not a
trailing slash, not `https`.

### Magic links and invites never arrive

`EMAIL_FROM` is not on a domain verified in Resend, or `RESEND_API_KEY` is
missing. Every send fails silently from the user's point of view.

Locally, use `ORBIT_DEV_LOGIN=1` instead of setting up email at all.

### A user cannot join

`ALLOWED_EMAIL_DOMAINS` is set and their domain is not in it. It is enforced on
both invite creation and user creation. The workspace may also have its own
narrower `allowedEmailDomains`.

## Realtime

### An endless "Reconnecting to live updates" banner

The most common failure in Orbit, and it has three causes.

**In production:** `NEXT_PUBLIC_REALTIME_URL` is set. It must not be. The socket
is served from the page's own origin at `/api/ws`, and a leftover value from a
standalone realtime host sends browsers to a dead origin. Because the ticket
still comes from the app, the failure looks like reconnection rather than an
error. Unset it and redeploy.

**Behind your own proxy:** the proxy is not passing websocket upgrades, or is
timing them out. See the nginx configuration in
[Self-hosting](self-hosting.md#run-it-on-your-own-server). The default
`proxy_read_timeout` of 60 seconds drops every idle socket once a minute, which
produces a banner that appears and disappears on a timer.

**Locally:** the realtime server is not running. `bun run dev` starts it.
`NEXT_PUBLIC_REALTIME_URL` should be `ws://localhost:3100`.

### The websocket never reaches a 101

`bunVersion` is set in `apps/web/vercel.json`, so functions run on the Bun
runtime where `experimental_upgradeWebSocket` silently never fires. Remove it.

It can also happen if something in the route awaits Redis or the database before
upgrading. Upgrade first, attach afterwards, and buffer whatever arrives in
between.

### Changes do not appear in other tabs, and there is no banner

The socket is connected but nothing is being published, so Redis is the problem.
Check `REDIS_URL` and that Redis is reachable from where the app runs.

```bash
redis-cli -u "$REDIS_URL" ping
```

### Some people see an update and others do not

A scope problem, and this one is a security bug rather than a sync bug, because
the reverse case means someone is being delivered a row they may not read.

Scopes have to match who may read the row. A project and its milestones carry
the scopes of the teams that own them, falling back to the workspace scope only
when the project belongs to no team. A private saved view carries its owner
alone. See [Architecture](architecture.md#scopes-decide-delivery).

### A user stays connected after signing out

Should not happen. Signing out publishes a revocation and the hub closes the
connection, and the hub also sweeps sessions on an interval as a backstop. If
you see it, that is worth reporting.

## Database

### `bun run db:push` hangs or times out

Against a hosted database, you are probably using the pooled connection string.
Schema changes need a direct session. Use the direct endpoint, usually port 5432
rather than 6543.

### Connection pool exhausted in production

`DATABASE_URL` points at the direct endpoint instead of the pooler. Serverless
functions open many short lived connections and the direct endpoint runs out.
Swap it for the pooled string.

### Tests deadlock or hit foreign key violations for no reason

Two test runs are sharing a database, which happens with two worktrees or two
agents. Set `ORBIT_TEST_LANE` to something unique in each:

```bash
ORBIT_TEST_LANE=my-branch bun run test
ORBIT_TEST_LANE=my-branch bun run db:test-lanes-drop
```

The cleanup drops that lane alone, so it cannot delete a lane another run is
using. Without `ORBIT_TEST_LANE` it refuses. `--all` drops every lane on that
Postgres and is the only mode that can touch someone else's.

### The demo data is a mess

```bash
bun run db:seed
```

It truncates and reloads. Use it only with a verified demo database, and never
point it at production. The exact default local target needs no confirmation;
every other verified target requires the exact confirmation described below.

Only the exact default Docker Compose target,
`postgres://orbit:orbit@localhost:5434/orbit` or the same target through
`127.0.0.1`, needs no confirmation. Every other target, including other
localhost and IPv4 loopback ports, databases, or credentials, plus `postgres`
and `host.docker.internal`, must have an explicit username and port in
`DATABASE_URL`. For these non-default targets, `db:seed` stops unless
`ORBIT_SEED_CONFIRM_TARGET` exactly matches the credential-safe
`host:port/database:user-sha256:<64 lowercase hex characters>` target printed in
the error. The username is decoded before hashing and is never printed. For
example:

```bash
ORBIT_SEED_CONFIRM_TARGET='db.example.com:5432/orbit:user-sha256:<64-character-sha256>' bun run db:seed
```

Multi-host URLs, ambiguous encoded authorities, and query options that can
change the target database or schema are refused. IPv6 connection URLs are also
refused because the current database driver misparses bracketed IPv6 hosts. Use
a hostname or IPv4 endpoint instead.

## Files

### Uploads fail in the browser, the server looks fine

The bucket CORS policy does not allow your origin. Uploads go straight from the
browser through a presigned PUT, so the server never sees the failure.

```bash
sed 's|__ORBIT_ORIGIN__|https://orbit.example.com|' infra/s3-cors.json > /tmp/cors.json
aws s3api put-bucket-cors --bucket "$S3_BUCKET" --cors-configuration file:///tmp/cors.json
```

### Uploads fail locally

MinIO is not running, or the bucket was not created. `bun run infra:up` does
both. The console is on <http://localhost:9011> with `orbitminio` and
`orbitminio`.

## Building and CI

### `bun run check-comments` fails

You added a comment. The policy allows only functional directives such as
`@ts-expect-error` and `biome-ignore`. Put the meaning in names and structure,
and put prose in the pull request or in `docs/`.

```bash
bun run check-comments
```

names the file and line.

### `bun run check-deps` fails after a dependency bump

A package listed in the root `overrides` block resolved to two versions, or a
manifest asked for a version the override will not let it have. Bun keeps a
transitive resolution that still satisfies its own range, so a bump applied to
one manifest alone leaves the previous copy nested under everything else that
depends on it. Two copies of a library whose types cross module boundaries, any
CodeMirror package above all, fail typecheck with `TS2375` on
`exactOptionalPropertyTypes`, and a facet or an instance compared across the two
copies fails at runtime as soon as the code reaches for one.

An override also shadows a direct dependency, which is why the second failure
exists: without it a bump could sit in `package.json` and install nothing. Move
both, then install.

```bash
bun pm why @codemirror/view
bun install
bun run check-deps
```

### Typecheck fails on something that looks fine

`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on, so
`array[0]` is `T | undefined` and an optional property cannot be set to
`undefined` explicitly. Both catch real bugs. Handle the `undefined` rather than
asserting it away, since non-null assertions are a lint error.

### The build fails but `bun run dev` works

Almost always a Bun built-in in shipped server code. The deployed runtime is
node, so `import ... from 'bun'` fails there. See the table in
[Architecture](architecture.md#bun-is-the-toolchain-not-the-runtime).

Test files and `apps/realtime` are exempt. `packages/realtime-server` is not,
because the web app imports it.

### E2E passes locally and fails in CI

Download the Playwright trace artifact from the failed run:

```bash
bunx playwright show-trace trace.zip
```

It shows every action, the DOM at each step, and the network. Usually a timing
assumption that holds on a fast machine and not on a CI runner.

## Still stuck

- [Discussions](https://github.com/Noveum/orbit/discussions) for questions.
- [Issues](https://github.com/Noveum/orbit/issues) for a bug.

Include the output of `bun --version`, your OS, whether it is local, self-hosted
or hosted Orbit, and the actual error. Those four make the difference between a
fix this week and a thread that goes nowhere.
