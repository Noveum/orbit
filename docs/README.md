# Orbit documentation

Orbit is a free, realtime, keyboard-first work tracker. Issues, boards, sprints,
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
| Connect GitHub or Slack | [Integrations](integrations.md) |
| Know how the realtime sync actually works | [Architecture](architecture.md) |
| Write or run the tests | [Testing](testing.md) |
| Fix something that broke | [Troubleshooting](troubleshooting.md) |
| See what is coming | [Roadmap](roadmap.md) |
| Contribute | [CONTRIBUTING.md](../CONTRIBUTING.md) |

## The five minute version

```bash
git clone https://github.com/Noveum/orbit.git
cd orbit
bun install
cp .env.example .env
bun run infra:up
bun run db:push && bun run db:test-setup && bun run db:seed
bun run dev
```

Open <http://localhost:3000> and sign in as `pulkit@noveum.ai`. The seed loads a
demo workspace with three teams, seven people, thirty two issues, projects,
sprints and docs, so there is something to click on immediately.

Full detail, including what each command does and what to do when one fails, is
in [Getting started](getting-started.md).

## What Orbit is

- **Issues** with priorities, labels, states, estimates, assignees and
  relations, as a fast list or a drag and drop board.
- **Sprints and cycles** for timeboxed planning, with scope, points and burndown.
- **Projects and milestones** that group work across teams.
- **Docs** with a rich editor, living next to the issues they describe.
- **Standup** as a board rather than a meeting, with a timer, a rotation and
  blockers.
- **Analytics**: scope, throughput, churn and distribution by assignee, project,
  label and estimate.
- **Search, filters and saved views**, shared with the team or kept private.
- **Realtime everywhere.** A change writes to Postgres, publishes to Redis, and
  fans out over a websocket to everyone allowed to see it.
- **An MCP server**, so an agent can read the board and file work with the same
  permissions the person who authorised it has.
- **Notifications**, an inbox, GitHub and Slack.

## What Orbit is not

It has no pricing, no seats and no usage limits, and it never will. It does not
phone home. It does not try to be a CRM, a helpdesk or a spreadsheet. When there
are two reasonable ways to do something, Orbit picks one and fixes that one.

## Getting help

- [Discussions](https://github.com/Noveum/orbit/discussions) for questions.
- [Issues](https://github.com/Noveum/orbit/issues) for bugs and concrete work.
- [SECURITY.md](../SECURITY.md) for anything that should not be public.

If a page here is wrong or missing something, that is a bug. Please
[tell us](https://github.com/Noveum/orbit/issues/new?template=documentation.yml).
