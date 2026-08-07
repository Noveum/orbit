# Architecture

Orbit is one Next.js app, plus Postgres, Redis and a bucket. The interesting
part is how a change reaches every other open screen in well under a second, and
how it reaches only the people entitled to see it.

## The shape

```
                        ┌──────────────────────────────┐
   browser  ◄──────────►│  Next.js app on Vercel node  │
   (React,              │                              │
    TanStack Query,     │  UI, REST handlers, auth,    │
    realtime client)    │  /api/ws, /mcp               │
                        └───┬───────────┬──────────┬───┘
                            │           │          │
                       ┌────▼────┐ ┌────▼────┐ ┌───▼────┐
                       │ Postgres│ │  Redis  │ │ Bucket │
                       │ (truth) │ │(fan-out)│ │(files) │
                       └─────────┘ └─────────┘ └────────┘
```

Everything ships as a single Vercel project. Nothing is containerised, and
nothing runs in Kubernetes.

## The workspace

```
apps/web                  Next.js app: UI, REST handlers, auth, /api/ws, /mcp
apps/realtime             Bun.serve websocket host, local development only
packages/realtime-server  Connection hub: tickets, scopes, presence, Redis fan-out
packages/realtime-client   Browser client: subscribe, patch, reconnect
packages/mcp-server       MCP tools and the fetch handler behind /mcp
packages/core             Domain operations shared by REST, MCP and the hub
packages/services         Markdown, storage, email, notifications, Slack, GitHub
packages/db               Drizzle schema, migrations, client, seed
packages/shared           Zod validators, domain types, event contracts, policy
```

The hub and the MCP tools live in packages rather than in the app for two
reasons: the app stays thin, and both keep their own test suites that run
without booting Next.

`apps/realtime` exists only because a Vercel function cannot upgrade a
connection under `next dev`. It is never deployed. In production the socket is
served from the app itself.

If two apps need a piece of code it belongs in `packages/shared`, never copied.

## A change, end to end

Someone drags an issue from Todo to In Progress.

**1. The browser applies it immediately.** TanStack Query patches the cache
optimistically. The card moves before any request is made, because a board that
waits for a round trip feels broken.

**2. The request hits a route handler.** The body is parsed with a Zod schema
from `@orbit/shared/validators`. Nothing unvalidated gets further.

**3. Authorization runs.** The handler asks `packages/shared/src/policy` whether
this principal may do this. The UI already hid the affordance, but that was
courtesy. This is the gate.

**4. Postgres is written, and `sync_id` is bumped.** A monotonic counter per
workspace. It is what lets a client that missed messages ask for everything
since the last one it saw, instead of refetching the world.

**5. A `SyncAction` is published to Redis.** It carries the `syncId`, the
`organizationId`, the `scopes` entitled to see it, the `action`
(`insert`, `update`, `delete`, `archive`, `unarchive`), the `model`, and the
row.

**6. The hub fans it out.** It is subscribed to Redis and holds every open
connection with the scopes that connection is subscribed to. The action goes to
matching connections and no others.

**7. Every other browser patches its cache.** The realtime stream invalidates
and patches. It never triggers a full refetch of a list the user is looking at,
because a list that reloads under you loses your scroll position and your
selection.

The originating client is identified by `x-orbit-client-id` and skips its own
echo, so the optimistic update is not overwritten by its own result.

## Scopes decide delivery

A scope is a string naming who may see a row:

```
org:<id>       everyone in the workspace
team:<id>      members of one team
project:<id>   people who can see a project
issue:<id>     people watching one issue
doc:<id>       people who can see a doc
user:<id>      one person
```

**A scope has to match who may read the row.** This is the part that is easy to
get subtly wrong, and getting it wrong is a security bug rather than a sync bug,
because a client would be handed a row it is not allowed to read.

Two rules that fall out of this:

- A project and its milestones carry the scopes of the teams that own them, and
  fall back to the workspace scope only when the project belongs to no team.
- A private saved view carries its owner alone.

## The socket

### Getting connected

A websocket cannot carry an Authorization header, so Orbit uses a ticket.

1. The client asks the app for one over normal authenticated HTTP.
2. The app returns a ticket carrying the user, the workspace and the session,
   signed with HMAC-SHA256, valid for 60 seconds.
3. The client opens the socket and presents it.
4. The hub verifies the signature, checks it has not expired, confirms the
   session is still live, and attaches.

Short lifetime because a ticket is in a URL, and URLs end up in logs.

### Staying connected

**A socket never outlives its session.** Signing out publishes a revocation on
the control channel and the hub closes that connection. The hub also sweeps the
sessions behind every open connection on an interval, so a session that expired
or was deleted is dropped even when nothing announced it. Belt and braces,
because the announcement is the thing that fails when a process dies.

### Reconnecting

The client tracks the last `syncId` it saw. On reconnect it asks for everything
since, and gets a replay rather than a refetch. The reconnect banner only
appears once retries have actually been failing, so a blip does not flash a
warning at anyone.

### Why node, and not Bun

`/api/ws` upgrades through `experimental_upgradeWebSocket` from
`@vercel/functions`, and Vercel only injects that bridge on the node runtime.
Setting `bunVersion` in `apps/web/vercel.json` moves every function to Bun,
where the upgrade silently never happens and the client retries forever against
a socket that never opens.

**Upgrade before doing anything else in that route.** Awaiting Redis or the
database first stops the handshake reaching a 101. Attach the hub after the
socket is open, and buffer whatever arrives in between.

## Bun is the toolchain, not the runtime

Bun installs, runs scripts, runs the TypeScript and runs the tests. Shipped
server code must not import a Bun built-in, because the deployed runtime is
node.

| Need | Use | Never |
| --- | --- | --- |
| Postgres | `postgres.js` via `drizzle-orm/postgres-js` | `Bun.SQL`, `pg` |
| Redis | `ioredis` | `Bun.RedisClient` |
| Object storage | `@aws-sdk/client-s3` | `Bun.S3Client` |
| Files | `node:fs/promises` | `Bun.file()`, `Bun.write()` |
| Password hashing | `@node-rs/argon2` | `Bun.password`, `bcrypt` |
| Sortable ids | `randomUUIDv7()` from `@orbit/shared/utils` | `ulid`, `nanoid` |

Test files and `apps/realtime` may use Bun built-ins, because both only ever run
under Bun. `packages/realtime-server` may not, because the web app imports it.

## Data

Drizzle over Postgres. Schema in `packages/db/src/schema/`, split by area:
`auth`, `oauth`, `org`, `work`, `content`, `comms`, `scrum`.

Tables are singular snake_case. Primary keys are UUIDv7 from
`randomUUIDv7()`, which sorts by creation time, so an index on the primary key
is already an index on age.

Issue identifiers are allocated atomically per team, so two people creating an
issue at the same moment never collide on `ENG-42`.

Migrations are applied from a developer machine against the target database,
never by a job in the platform, so any schema change must be pushed before the
code that depends on it ships.

## Authorization

One place: `packages/shared/src/policy`. It exports a permission list and the
roles that hold each one.

- **Server routes enforce it.** This is the gate.
- **The UI reads the same policy** to hide what you cannot do. Courtesy, never
  a gate.
- **MCP tools run through it too**, so an agent inherits exactly the permissions
  of whoever authorised it.

One file means an audit is reading one file.

## Auth

better-auth. Passkeys, Google, GitHub and magic links. Email and password is off
unless `ORBIT_PASSWORD_AUTH=true`, hashed with argon2id, rate limited, and never
a replacement for the passwordless methods.

The web app also hosts the OAuth server for MCP, through the better-auth `mcp`
plugin: discovery under `/.well-known/oauth-*`, dynamic client registration,
PKCE, and a consent screen at `/oauth/authorize` where the user picks a
workspace and re-verifies a passkey. See [MCP server](mcp.md).

## The front end

- **Server state is TanStack Query.** Optimistic mutations, and the realtime
  stream patches the cache.
- **Radix primitives** for anything with real semantics, so keyboard and screen
  reader behaviour is not reinvented.
- **Theming** through CSS custom properties and `next-themes`. Light and dark
  are both first class, and no component hardcodes a colour.
- **Motion never touches layout.** Nothing that triggers reflow animates.
  Entrance, exit and gesture motion is transform and opacity only. Hover and
  focus may also transition colour, through the shared tokens in
  `apps/web/src/lib/interaction.ts` so the set stays auditable. Micro
  interactions can go as fast as 80ms, nothing exceeds 200ms, everything
  respects `prefers-reduced-motion`.

## Design decisions worth knowing

**Why Redis and not Postgres LISTEN/NOTIFY.** `NOTIFY` payloads are capped at
8000 bytes and delivery is tied to a connection that pooled serverless functions
do not keep. Redis pub/sub does not care how the app is scaled.

**Why a monotonic `sync_id` and not timestamps.** Clocks disagree and are not
monotonic. A counter per workspace gives an unambiguous "everything after this".

**Why the client patches instead of refetching.** A refetch resets scroll and
selection. Patching keeps the user where they were, which is the whole point of
realtime.

**Why optimistic updates everywhere.** A board that waits for a round trip
before moving a card feels broken, even at 50ms.

## Further reading

- [Concepts](concepts.md) for the domain vocabulary.
- [Testing](testing.md) for how this is verified.
- [CONTRIBUTING.md](../CONTRIBUTING.md) for the rules the code is held to.
