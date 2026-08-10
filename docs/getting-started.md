# Getting started

This gets Orbit running on your machine with a demo workspace you can click
around in. It takes about five minutes, most of which is Docker pulling images.

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.3 or newer | Installs packages, runs scripts, runs TypeScript, runs tests |
| Docker | Any recent version | Postgres, Redis and object storage |
| Git | Any | Obviously |

That is the whole list. Bun replaces npm, pnpm, yarn, ts-node, jest and turbo,
so do not install any of those. If you already have Node installed it will not
get in the way, and Orbit will not use it.

Install Bun if you do not have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Set it up

```bash
git clone https://github.com/Noveum/orbit.git
cd orbit
bun install
cp .env.example .env
```

`.env.example` is a working local configuration. You do not need to edit it to
get started, and every secret in it is a placeholder that only works locally.

Start the backing services:

```bash
bun run infra:up
```

That runs Postgres on 5434, Redis on 6380 and MinIO on 9010, all through
`docker-compose.yml`. The ports are deliberately not the defaults, so Orbit does
not collide with anything else you have running.

Create the schema, create the test databases, and load the demo data:

```bash
bun run db:push
bun run db:test-setup
bun run db:seed
```

Then start everything:

```bash
bun run dev
```

Open <http://localhost:3000>.

## Sign in

`.env.example` sets `ORBIT_DEV_LOGIN=1`, which puts a list of the seeded users
on the login screen and signs you in with one click. No email, no password, no
waiting for a magic link.

Start as **`alex@orbit.example`**, who is an admin on all three teams and sees
everything.

The other seeded users are useful for seeing how permissions behave. They all
sign in the same way:

| User | Role | Teams |
| --- | --- | --- |
| `alex@orbit.example` | Admin | Engineering, Design, Marketing |
| `sam@orbit.example` | Admin | Engineering, Marketing |
| `jordan@orbit.example` | Member | Engineering, Design |
| `casey@orbit.example` | Member | Engineering, Design |
| `taylor@orbit.example` | Member | Marketing |
| `robin@orbit.example` | Contributor | Engineering |
| `drew@orbit.example` | Guest | Marketing |

Sign in as `drew@orbit.example` to see what a guest can and cannot do. Buttons
disappear, because the UI reads the same policy the server enforces.

**`ORBIT_DEV_LOGIN` must never be set on a deployed environment.** It signs
anyone in as anyone.

## What you just got

The seed creates a workspace with three teams, seven people, thirty two issues
across every state, projects with milestones, sprints, docs and notifications.

Things worth trying first:

1. Press <kbd>Cmd</kbd> <kbd>K</kbd> anywhere. That is the command palette, and
   it is how most of Orbit is meant to be driven.
2. Go to the Engineering board and drag an issue between columns.
3. Open the same board in a second tab and drag again. Both tabs update at once,
   with no refresh and no polling.
4. Press <kbd>g</kbd> then <kbd>s</kbd> to jump to sprints, <kbd>g</kbd> then
   <kbd>d</kbd> for docs. Press <kbd>?</kbd> for the full list.
5. Open an issue and press <kbd>s</kbd>, <kbd>p</kbd>, <kbd>a</kbd> or
   <kbd>l</kbd> to change status, priority, assignee or labels without clicking.

## The ports

| Service | Port | Notes |
| --- | --- | --- |
| Web | 3000 | The app |
| Realtime | 3100 | Local development only, never deployed |
| Postgres | 5434 | |
| Redis | 6380 | |
| MinIO (S3 API) | 9010 | |
| MinIO console | 9011 | Sign in with `orbitminio` and `orbitminio` |

The realtime server only exists locally, because a Vercel function cannot
upgrade a websocket under `next dev`. In production the socket is served from
the app itself at `/api/ws`. See [Architecture](architecture.md).

## Day to day commands

```bash
bun run dev            # web and realtime together, hot reloading
bun run verify         # lint, comment policy, types, tests. The same four CI runs
bun run lint:fix       # fix what Biome can fix
bun run db:seed        # reset the demo data back to a known state
bun run db:studio      # browse the database in Drizzle Studio
bun run infra:down     # stop the containers, keep the data
bun run infra:reset    # stop the containers and destroy the data
bun run test:e2e       # Playwright, needs bun run dev already running
bun run screenshots    # capture the docs screenshots, needs bun run dev running
```

To run one package's tests quickly, run them from inside it:

```bash
cd packages/shared && bun test
```

## Making changes

`bun run dev` hot reloads the web app. Schema changes need a push:

```bash
# after editing packages/db/src/schema/*.ts
bun run db:push
```

`db:push` applies the schema directly, which is what you want in development.
Generated migrations are for deployments. See [Self-hosting](self-hosting.md).

## Common first problems

**`bun run verify` fails with connection errors.** You skipped
`bun run db:test-setup`. Run it. Each package tests against its own database.

**Port already in use.** Something else is on 3000, 5434, 6380 or 9010. Find it
with `lsof -i :3000`. A previous `bun run dev` that did not shut down cleanly is
the usual culprit.

**Docker containers will not start.** `docker ps -a` and look at the exit codes.
If Postgres will not come up after a schema change went wrong,
`bun run infra:reset` destroys the volumes and starts clean, then re-run
`db:push`, `db:test-setup` and `db:seed`.

**The login screen shows no users.** Either `ORBIT_DEV_LOGIN=1` is missing from
`.env`, or you have not run `bun run db:seed`.

**A "Reconnecting to live updates" banner will not go away.** The realtime
server is not running or `NEXT_PUBLIC_REALTIME_URL` is wrong. Locally it should
be `ws://localhost:3100`. In production it must not be set at all.

**Tests deadlock or hit foreign key errors for no reason.** Two test runs are
sharing a database. Set `ORBIT_TEST_LANE` to something unique in each.

Anything else, see [Troubleshooting](troubleshooting.md).

## Next

- [Concepts](concepts.md), so the vocabulary makes sense.
- [Architecture](architecture.md), for how the realtime layer works.
- [CONTRIBUTING.md](../CONTRIBUTING.md), if you want to send a change.
