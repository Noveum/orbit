# @orbit/mcp

Orbit's MCP server. It speaks the Model Context Protocol over streamable HTTP so an agent can read
and change work in Orbit through the same domain services and the same permission policy the web app
uses.

- Endpoint: `POST http://localhost:3200/mcp`
- Health: `GET http://localhost:3200/health`
- Auth: OAuth 2.1 (discovery, PKCE, dynamic client registration). No API keys.

Every call is resolved to the Orbit user who signed in, acting in the workspace they chose when they
approved the connection. A tool can never do more than that person could do in the UI: a guest gets
`forbidden` from `create_issue`, and nobody can touch a team they are not on.

## Run it

```
bun run infra:up
bun run db:push
bun run db:seed
bun run dev
```

`MCP_PORT` sets the port and defaults to `3200`. `ORBIT_PUBLIC_URL` is the origin that serves the
OAuth discovery documents (the web app), and defaults to `http://localhost:3000`. The MCP server
uses it to build the `WWW-Authenticate` challenge it returns on `401`.

## How auth works

The web app hosts the OAuth server through better-auth. An unauthenticated request to `/mcp` gets a
`401` with a `WWW-Authenticate` header pointing at
`<ORBIT_PUBLIC_URL>/.well-known/oauth-protected-resource/mcp`. From there an MCP client discovers the
authorization server, registers itself, runs the PKCE authorization-code flow (the user signs in to
Orbit, picks a workspace, and approves), and presents the resulting access token as a bearer. The MCP
server validates that token against the shared database and resolves it to a workspace principal.

## Connect a client

```
claude mcp add --transport http orbit http://localhost:3200/mcp
```

Point any MCP client at the server URL. No token goes in the config: the client discovers OAuth from
the `401` and opens a browser for sign-in.

```json
{
  "mcpServers": {
    "orbit": {
      "type": "http",
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

In production the server URL is `https://orbit.noveum.ai/mcp` and the discovery documents are served
from the same host. Manage or revoke connected clients under Settings, Integrations.

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
the process. A missing or invalid token fails the HTTP request with `401`, and a `WWW-Authenticate`
header points the client at the OAuth discovery documents, before any tool runs.

## Tests

```
bun run --filter "@orbit/mcp" test
```

They run against a real Postgres. Point `TEST_DATABASE_URL` at a database whose name contains `test`,
or let it default to `postgres://orbit:orbit@localhost:5434/orbit_test_mcp`, and push the schema once
with `DATABASE_URL=... bun run --filter "@orbit/db" push`.
