# MCP server

Orbit ships a [Model Context Protocol](https://modelcontextprotocol.io) server,
so an AI assistant can read your board and do work in it. Claude, Cursor, VS
Code and anything else that speaks MCP can connect.

The endpoint is your Orbit deployment plus `/mcp`:

```
https://orbit.example.com/mcp
```

There is nothing extra to run. The MCP server is part of the app.

## How access works

**OAuth only. There are no API keys**, and there will not be.

An API key is a secret that lives forever, gets pasted into config files, and
carries whatever permissions its creator had. When an agent runs unattended,
that is the wrong shape. Orbit instead makes you sign in, pick a workspace, and
approve the scopes, and the resulting grant can be revoked from the same place.

The flow when a client connects:

1. The client discovers the OAuth server at `/.well-known/oauth-authorization-server`.
2. It registers itself dynamically. No manual client setup.
3. You are sent to `/oauth/authorize`, where you pick the workspace and
   re-verify a passkey.
4. You approve the scopes.
5. The client gets an access token bound to you, that client, and the workspace
   you chose.

PKCE throughout. The grant is a row in the database, so revoking it takes effect
immediately.

**An agent never has more permission than you do.** Every tool runs against the
same policy that governs your account, so an agent authorised by a guest can
read and comment, and nothing else.

## Scopes

| Scope | Grants |
| --- | --- |
| `orbit.read` | Read issues, projects, sprints, docs and members |
| `orbit.write` | Create and update issues, comments, projects and sprints |

Tools are registered according to the scopes the token actually carries. With
only `orbit.read`, the write tools are not merely refused, they are never
offered, so the assistant cannot attempt something it will not be allowed to
finish. A token carrying neither scope is refused with a `403` before any tool
is registered.

Give an agent `orbit.read` alone unless you specifically want it changing
things.

## Connect a client

### Claude Code

```bash
claude mcp add --transport http orbit https://orbit.example.com/mcp
```

Then run `/mcp` inside Claude Code and follow the sign-in.

### Claude Desktop

**Settings**, **Connectors**, **Add custom connector**, then paste
`https://orbit.example.com/mcp`. A browser window opens for you to authorise it.

### Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "orbit": {
      "url": "https://orbit.example.com/mcp"
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "orbit": {
      "type": "http",
      "url": "https://orbit.example.com/mcp"
    }
  }
}
```

### Running locally

Point at `http://localhost:3000/mcp` instead. Everything else is the same.

## What the tools do

Seventy odd tools across seven groups. Read tools need `orbit.read`, write tools
need `orbit.write`.

Most tools take names rather than ids. A team is `"ENG"` or `"Engineering"`, an
assignee is a name, handle, email or the literal `"me"`, and a project is a name
or a slug. Assistants are much better at names than at UUIDs, and Orbit resolves
them.

### Identity and workspace

| Tool | Scope | Does |
| --- | --- | --- |
| `get_me` | read | Who the token belongs to, and their role |
| `list_teams` | read | Teams in the workspace |
| `list_users` | read | Members |
| `list_states` | read | Workflow states on a team |
| `list_labels` | read | Labels |
| `list_members` | read | Members with their roles |
| `invite_member` | write | Invite someone |
| `list_notifications` | read | Your inbox: mentions, assignments, replies and state changes |
| `mark_notification_read` | write | Mark your own notifications read |

### Issues

| Tool | Scope | Does |
| --- | --- | --- |
| `get_issue` | read | One issue by identifier |
| `list_issue_comments` | read | The comment thread on an issue, oldest first |
| `search_issues` | read | Search and filter |
| `list_my_issues` | read | Assigned to the caller |
| `copy_branch_name` | read | The git branch name for an issue |
| `create_issue` | write | Create one, returns `ENG-42`. Name a label by id when two share a name |
| `update_issue` | write | Title, description, state, priority, assignee, labels, estimate |
| `move_issue` | write | Move between states or teams. A team move drops the labels the new team cannot use |
| `add_comment` | write | Comment |
| `set_relation` | write | Blocks, blocked by, relates to, duplicates |
| `archive_issue`, `unarchive_issue`, `delete_issue` | write | |
| `edit_comment`, `delete_comment` | write | |

### Projects and milestones

| Tool | Scope | Does |
| --- | --- | --- |
| `list_projects` | read | Projects |
| `project_progress` | read | Completion against scope |
| `list_project_milestones`, `list_milestones` | read | Milestones |
| `create_project`, `update_project` | write | |
| `archive_project`, `delete_project` | write | |
| `create_milestone`, `update_milestone`, `delete_milestone` | write | |
| `reorder_milestones` | write | The whole order of a project milestones |

### Sprints and cycles

| Tool | Scope | Does |
| --- | --- | --- |
| `list_cycles` | read | Sprints on a team |
| `active_cycle` | read | The one running now |
| `cycle_progress` | read | Burndown and completion |
| `create_cycle`, `update_cycle` | write | |
| `complete_cycle` | write | Close it and handle carryover |
| `move_to_cycle` | write | Move issues in |
| `delete_sprint` | write | |

### Docs

| Tool | Scope | Does |
| --- | --- | --- |
| `list_docs`, `get_doc` | read | Docs |
| `list_doc_collections` | read | Collections |
| `list_doc_comments` | read | Comments on a doc |
| `create_doc`, `update_doc`, `archive_doc` | write | |
| `comment_on_doc`, `edit_doc_comment`, `delete_doc_comment` | write | |
| `create_doc_collection` | write | |

### Views

| Tool | Scope | Does |
| --- | --- | --- |
| `list_views` | read | Saved views, each with the filter state it stores |
| `create_view`, `update_view`, `delete_view` | write | |

`create_view` takes the same state the app stores. Conditions live under
`filter.filter.children`, each one shaped like
`{"kind":"condition","property":"priority","operator":"in","values":["1"]}`. A key the state
does not define is rejected rather than dropped, so a filter written in some other shape fails
loudly instead of saving a view that filters nothing. Call `list_views` first and copy a shape
that already works.

### Teams, labels and workflow states

| Tool | Scope | Does |
| --- | --- | --- |
| `create_team`, `update_team` | write | |
| `add_team_member`, `remove_team_member` | write | |
| `remove_member` | write | Remove from the workspace |
| `create_label`, `update_label`, `delete_label` | write | Pass `team` to pin a label to one team, `null` to widen it back. Name a label by id when two share a name |
| `create_state`, `update_state` | write | A status carries a category the product reads, so changing it re-dates the issues in it |
| `delete_state` | write | Refused while issues sit in it unless `moveTo` names the status they go to |
| `reorder_states` | write | The whole board order, first column first |

## Things worth asking for

Once connected, these all work:

- "What am I working on this sprint?"
- "File a bug on Engineering: passkey sign-in fails on Safari when no credential is registered. High priority, assign it to me."
- "What is blocking the Realtime Sync Engine project?"
- "Summarise what the team finished last sprint and what carried over."
- "Read ENG-42 and write the migration it describes."
- "Everything in Design labelled Bug with no assignee, and who should take each one."
- "Post a summary of what each person closed yesterday to Slack."

The last one is the shape that pays for itself. An agent with `orbit.read` and a
Slack connection can write the update nobody wants to write.

## Managing access

Grants live under **Settings**, **Integrations**, **MCP**, where you can see
which clients are connected, which workspace and scopes each got, and revoke
any of them. Revocation is immediate.

## When it does not work

**"401 Unauthorized" or a `WWW-Authenticate` challenge.** The token expired or
was revoked. Reconnect, and the client will re-run the OAuth flow.

**"403" and no tools at all.** The token carries neither `orbit.read` nor
`orbit.write`. Reauthorise and approve at least one scope.

**Write tools are missing.** The token only has `orbit.read`. That is working as
intended. Reauthorise with `orbit.write` if you want it.

**The client cannot discover the server.** Check `NEXT_PUBLIC_APP_URL` matches
the origin you are actually serving from, since discovery documents are built
from it. Confirm with:

```bash
curl https://orbit.example.com/.well-known/oauth-authorization-server
```

**A tool says it cannot find a team or a person.** Names are resolved, but they
have to be unambiguous. Use the team key, or the exact name.

## For contributors

Tools live in `packages/mcp-server/src/tools/`, grouped by area. Each is defined
with `defineTool`, declares `readOnly`, and validates its input with Zod.

Adding one means adding it to the right group file, and adding a test in
`packages/mcp-server/tests/`. A tool that mutates must set `readOnly: false`, or
it will be handed to read-only tokens.

See [CONTRIBUTING.md](../CONTRIBUTING.md).
