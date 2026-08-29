# Orbit documentation

Orbit is a free, realtime, keyboard-first task manager. Issues, boards, sprints,
projects and docs, all of which update the moment anyone changes anything.

There is no pricing, no billing and no paid tier, so nothing in these docs is
gated behind a plan.

## Start here

| If you want to | Read |
| --- | --- |
| Run Orbit on your machine in five minutes | [Getting started](getting-started.md) |
| Understand what Orbit calls things | [Concepts](concepts.md) |
| Put Orbit on the internet for your team | [Self-hosting](self-hosting.md) |
| Look up an environment variable | [Configuration](configuration.md) |
| Stop reaching for the mouse | [Keyboard shortcuts](keyboard-shortcuts.md) |
| Let an AI agent read and update your board | [MCP server](mcp.md) |
| Connect GitHub | [Integrations](integrations.md) |
| Know how the realtime sync actually works | [Architecture](architecture.md) |
| Write or run the tests | [Testing](testing.md) |
| Fix something that broke | [Troubleshooting](troubleshooting.md) |
| See what is coming | [Roadmap](roadmap.md) |
| Contribute | [CONTRIBUTING.md](https://github.com/Noveum/orbit/blob/main/CONTRIBUTING.md) |

## The five minute version

The canonical quick start is in [Getting started](getting-started.md). Follow
that page for the full commands and troubleshooting notes.
## What Orbit is

- **Issues** with priorities, labels, states, estimates, assignees, multiple
  reviewers and relations, as a fast list or a drag-and-drop board.
- **Sprints and cycles** for timeboxed planning, with scope, points and burndown.
- **Projects and milestones** that group work across teams.
- **Docs** with a rich editor, living next to the issues they describe.
- **Standup** as a Kanban of the whole workspace, filtered to work a person
  owns or reviews with a click.
- **Analytics**: scope, throughput, churn and distribution by assignee, project,
  label and estimate.
- **Search, filters and saved views**, shared with the team or kept private.
- **Realtime everywhere.** A change writes to Postgres, publishes to Redis, and
  fans out over a websocket to everyone allowed to see it.
- **An MCP server**, so an agent can read the board and file work with the same
  permissions the person who authorised it has.
- **Notifications**, an inbox and GitHub integration.

## What Orbit is not

It has no pricing, no seats and no usage limits, and it never will. It does not
phone home. It does not try to be a CRM, a helpdesk or a spreadsheet. When there
are two reasonable ways to do something, Orbit picks one and fixes that one.

## Getting help

- [Discussions](https://github.com/Noveum/orbit/discussions) for questions.
- [Issues](https://github.com/Noveum/orbit/issues) for bugs and concrete work.
- [SECURITY.md](https://github.com/Noveum/orbit/blob/main/SECURITY.md) for anything that should not be public.

If a page here is wrong or missing something, that is a bug. Please
[tell us](https://github.com/Noveum/orbit/issues/new?template=documentation.yml).
