# @orbit/mcp

Orbit's MCP server. It speaks the Model Context Protocol over streamable HTTP so an agent can read
and change work in Orbit through the same domain services and the same permission policy the web app
uses.

- Endpoint: `POST http://localhost:3200/mcp`
- Health: `GET http://localhost:3200/health`
- Auth: `Authorization: Bearer orb_...`

Every call is resolved to the Orbit user who owns the API key. A tool can never do more than that
person could do in the UI: a guest gets `forbidden` from `create_issue`, and nobody can touch a team
they are not on.

## Run it

```
pnpm infra:up
pnpm db:push
pnpm db:seed
pnpm --filter @orbit/mcp dev
```

`MCP_PORT` sets the port and defaults to `3200`.

## Mint an API key

```
pnpm --filter @orbit/mcp create-key -- --email pulkit@noveum.ai --name "Local agent"
```

Flags: `--email` (required), `--name`, `--org <slug>` when the user belongs to several workspaces,
and `--expiresInDays`. The key is printed once. Only a SHA-256 hash of it is stored, so it cannot be
shown again. Set `revoked_at` on the row in `api_key` to turn a key off.

## Connect a client

```
claude mcp add --transport http orbit http://localhost:3200/mcp
```

Add the key as a bearer token in your client configuration, for example:

```json
{
  "mcpServers": {
    "orbit": {
      "type": "http",
      "url": "http://localhost:3200/mcp",
      "headers": { "Authorization": "Bearer orb_your_key_here" }
    }
  }
}
```

## Tools

Identifiers are human friendly everywhere. A team is `ENG`, a team name, or an id. An issue is
`ENG-42` or an id. A user is a name, handle, email, id, or `me`. A cycle is a name, a number, an id,
or `active`.

| Tool | Arguments |
| --- | --- |
| `get_me` | none |
| `list_teams` | `includeArchived?` |
| `list_users` | none |
| `list_states` | `team` |
| `list_labels` | `team?` |
| `create_issue` | `team`, `title`, `description?`, `state?`, `priority?`, `assignee?`, `project?`, `cycle?`, `parent?`, `labels?`, `estimate?`, `dueDate?` |
| `update_issue` | `issue`, `title?`, `description?`, `state?`, `priority?`, `assignee?`, `project?`, `cycle?`, `labels?`, `estimate?`, `dueDate?` |
| `get_issue` | `issue` |
| `search_issues` | `query?`, `team?`, `project?`, `cycle?`, `assignee?`, `state?`, `stateCategory?`, `label?`, `parent?`, `includeArchived?`, `includeSubIssues?`, `orderBy?`, `limit?`, `cursor?` |
| `list_my_issues` | `stateCategory?`, `limit?` |
| `move_issue` | `issue`, `state?`, `team?`, `beforeIssue?`, `afterIssue?` |
| `add_comment` | `issue`, `body`, `replyTo?` |
| `set_relation` | `issue`, `relatedIssue`, `type` |
| `copy_branch_name` | `issue` |
| `list_projects` | `includeArchived?` |
| `create_project` | `name`, `summary?`, `description?`, `status?`, `health?`, `lead?`, `startDate?`, `targetDate?`, `teams?` |
| `project_progress` | `project` |
| `list_cycles` | `team` |
| `active_cycle` | `team` |
| `cycle_progress` | `team`, `cycle` |
| `move_to_cycle` | `issue`, `cycle` |
| `list_members` | none |
| `invite_member` | `email`, `role?`, `teams?` |

Writes return a `deltas` array describing the `SyncAction`s that were published to Redis, so a caller
can see exactly what the realtime stream carried.

## Errors

A domain error comes back as a tool result with `isError: true` and a JSON body such as
`{"error":{"code":"forbidden","message":"Your role cannot issue create."}}`. Stack traces never leave
the process. A missing or invalid key fails the HTTP request with `401` before any tool runs.

## Tests

```
pnpm --filter @orbit/mcp test
```

They run against a real Postgres. Point `TEST_DATABASE_URL` at a database whose name contains `test`,
or let it default to `postgres://orbit:orbit@localhost:5434/orbit_test_mcp`, and push the schema once
with `DATABASE_URL=... pnpm --filter @orbit/db push`.
