# Roadmap

What is built, what is next, and what we have decided against. Tracked in
[issues labelled `roadmap`](https://github.com/Noveum/orbit/labels/roadmap),
which is always more current than this page.

This is a direction, not a set of promises with dates on them. Things move when
someone picks them up, and if you want something sooner the fastest route is to
build it. Anything marked **help wanted** is one we would particularly like a
hand with.

## Shipped

The core is done and in daily use.

- **Issues** with priorities, labels, states, estimates, assignees and
  relations, as a list or a drag and drop board.
- **Sprints and cycles** with scope, points, burndown and carryover.
- **Projects and milestones** across teams.
- **Docs** with a rich editor, collections, public share links and comments.
- **Standup** as a workspace Kanban you filter to one person with a click.
- **Analytics**: scope, throughput, churn, and distribution by assignee,
  project, label and estimate.
- **Search, filters and saved views**, shared or private.
- **Realtime everywhere**, scoped so delivery matches read permission.
- **Command palette and keyboard shortcuts** for every action.
- **Notifications and an inbox**, with per-event preferences and quiet hours.
- **Auth**: passkeys, Google, GitHub, email OTP, optional password.
- **Roles and permissions**: admin, member, contributor, guest.
- **MCP server** over OAuth, with sixty odd tools and scoped access.
- **GitHub** pull request linking.
- **File attachments** through presigned uploads.
- **Light and dark**, both first class.

## Next

The things we think matter most.

### Mobile and responsive

Orbit is built for a keyboard and a large screen, and it shows on a phone. The
read-only cases matter most: checking the board, reading an issue, replying to a
comment.

**help wanted.** This is a large, well defined piece of work with no
architectural risk.

### Internationalisation

Every string is currently English and hardcoded. Extracting them and adding a
locale layer unblocks every translation contribution that follows.

**help wanted.** Ideal for a first substantial contribution, and it is the
change that most widens who can use Orbit.

### Outbound webhooks

Fire on issue and project events so Orbit can drive other systems. The most
requested integration feature, and the MCP server only partly covers it.

### Importers

Orbit has validated readers for Plane and Linear exports, plus reusable mapping
and row-building helpers. There is no supported command that writes either
export into an Orbit database.

A supported importer must be tenant-neutral, authorize an explicit target
organization, separate dry-run and apply modes, and require typed confirmation
before deleting or replacing data. It must reject unsafe remote targets,
preserve existing tenants, define collision and retry behavior, apply changes
transactionally and idempotently, and have tested rollback and recovery paths.
The retained Plane export fetcher is internal groundwork, not a supported CLI.
If it is exposed again, its API key and workspace must remain explicit.

Jira and GitHub Issues are the other two worth having.

**help wanted.** Each importer is independent, so they can be picked up
separately.

### Custom fields

Per-workspace fields on issues, with the filters and views to match. The most
requested thing that Orbit deliberately does not have yet, because doing it
badly makes every other surface worse.

**Needs design first.** Comment on the issue before writing code.

### Accessibility audit

Radix gives real semantics, and keyboard operation and focus rings are already
there. What is missing is a proper audit with screen readers, and the fixes that
come out of it.

**help wanted.**

## Later

- **Recurring issues** for anything on a cadence.
- **Time tracking**, optional and off by default.
- **A public API** beyond MCP, for people who want to script Orbit directly.
- **Offline support**, building on the local-first store that is already there.
- **Templates** for issues, projects and docs.
- **Automation rules**, the "when this, do that" kind.
- **Roadmap and timeline views** across projects.
- **A desktop app**, mostly for global shortcuts and faster cold start.

## Not doing

Saying no is what keeps the rest coherent.

**Pricing, billing, plans, seats or usage limits.** There are no paid tiers and
there is no scaffolding for a future one. This is the whole point of Orbit, and
it is not up for discussion.

**Telemetry that phones home.** Your data stays in your Postgres. If we want to
know how something is used, we will ask.

**A second way to do something Orbit already does.** We would rather fix the
first way. Two half-good ways to filter issues is worse than one good one.

**Being a CRM, a helpdesk, a wiki platform or a spreadsheet.** Orbit tracks
work. Tools that do everything are the reason people are looking for a
replacement in the first place.

**Plugins that execute arbitrary code.** The security surface is not worth it.
The MCP server covers the extension cases with permissions that are actually
enforced.

## Influencing this

- **Comment on the issue.** A note explaining why something matters to your team
  moves it up more than a reaction does.
- **Open a feature request.** Describe the workflow that is painful, not the
  widget you want. See
  [CONTRIBUTING.md](../CONTRIBUTING.md#proposing-features).
- **Build it.** Comment first so we can agree the shape, then go. Anything
  marked **help wanted** already has agreement.

## Releases

Orbit ships continuously from `main`. There are no long lived release branches
and no backporting, so self-hosted deployments should track `main` or a recent
tag.

Anything requiring action from someone self-hosting is labelled
[`breaking change`](https://github.com/Noveum/orbit/labels/breaking%20change)
and called out in the release notes.
