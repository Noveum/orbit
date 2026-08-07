# Concepts

The vocabulary Orbit uses, and what each thing is actually for. If you have used
Linear or Jira most of this will be familiar, and the places where Orbit differs
are called out.

## Workspace

The top level container. A workspace has members, teams, projects, docs, labels
and settings, and nothing crosses between workspaces.

One workspace per company is the normal setup. You can belong to several and
switch between them from the top left, and each keeps its own everything.

A workspace can restrict which email domains may join, on top of the
server-level `ALLOWED_EMAIL_DOMAINS`.

## Members and roles

Everyone in a workspace has one of four roles. Permissions are cumulative, so
each role can do everything the one below it can.

| Role | Can do |
| --- | --- |
| **Guest** | Read issues, projects and docs. Comment, react |
| **Contributor** | Everything a guest can, plus create and update issues, upload attachments, manage their own views |
| **Member** | Everything a contributor can, plus delete issues, manage projects, cycles, milestones, labels, workflows, and write and publish docs |
| **Admin** | Everything, plus invite and manage members, manage integrations and manage the workspace |

Every authorization decision goes through `packages/shared/src/policy`, which is
one file that both the server and the UI read. The server enforces it. The UI
uses it to hide buttons you cannot use, never as the only gate.

Guests are the useful one to understand: a contractor or a stakeholder can be in
the workspace, read the board and comment, without being able to change work.

## Teams

Teams are how work is divided, and they own the parts of Orbit that need a
boundary. Each team has:

- A **key**, two to five letters, which prefixes every issue identifier. The
  Engineering team's issues are `ENG-1`, `ENG-2` and so on.
- Its own **workflow states**.
- Its own **sprints and cycles**.
- Its own **board and issue list**.

The demo workspace seeds Engineering (`ENG`), Design (`DES`) and Marketing
(`MKT`).

Teams also decide realtime delivery. A project and its milestones carry the
scopes of the teams that own them, so a change is only pushed to people entitled
to see it.

## Issues

The unit of work. An issue has a title, a markdown description, a state, a
priority, an assignee, labels, an estimate, and relations to other issues.

Its **identifier** is the team key plus a number, like `ENG-42`. Identifiers are
allocated atomically, so two people creating issues at the same moment never
collide. Type an identifier in the command palette to jump straight to it.

### States

Each state belongs to a category, and the category drives the board columns,
progress and analytics.

| Category | Meaning |
| --- | --- |
| Triage | Arrived, not yet decided on |
| Backlog | Decided, not scheduled |
| Todo | Scheduled, not started |
| In Progress | Being worked on |
| In Review | Waiting on review |
| Done | Finished |
| Canceled | Deliberately not doing it |

Teams can rename states and add their own, but every state maps to one of these
categories, which is what keeps analytics comparable across teams.

### Priority

Urgent, High, Medium, Low, or none. Sorting by priority puts unset last, on the
grounds that an unprioritised issue is not urgent.

### Relations

Issues can block, be blocked by, relate to, or duplicate each other. Blocking is
the one that changes behaviour: blocked issues surface in standup, because that
is the moment someone can unblock them.

### Estimates

Points, on the usual scale. Optional. Sprints can track scope by issue count or
by points, and analytics shows both.

## Labels

Workspace-wide tags with a colour. Labels cross teams, which is what makes them
useful for things like `Bug`, `Performance` or `Docs`, and they are the main
thing filters and saved views are built from.

## Sprints and cycles

Timeboxed periods of work belonging to a team. A sprint has a start date, an end
date, a set of issues, and a scope measured in issues or points.

Orbit uses **sprint** and **cycle** for the same underlying thing. Cycles are
the continuous, always-one-running flavour, sprints the named, planned flavour,
and both are the same object.

What a sprint gives you:

- **Scope**, and how it changed after the sprint started.
- **Burndown** of remaining work against time.
- **Carryover**, meaning what did not finish when you complete the sprint.

Completing a sprint asks what to do with unfinished issues: move them to the
next sprint, or back to the backlog.

## Projects and milestones

Projects group related work that does not fit inside one team or one sprint.
"Realtime Sync Engine" is a project; it has issues from Engineering and Design,
runs across several sprints, and has a lead, a target date and a status.

**Milestones** divide a project into stages, so progress is measured against
something real rather than a percentage of a moving total.

The difference from sprints in one line: a sprint is a period of time, a project
is a body of work. An issue is usually in both.

## Docs

Markdown documents with a rich editor, living beside the issues they describe
rather than in a separate tool.

- Organised into **collections**, and nestable.
- **Visibility** is workspace-wide, or private to the author.
- **Shareable** through a public link with a token, for people outside the
  workspace.
- Commentable, and searchable alongside issues from the command palette.
- Optionally bound to a path in a repository, so a doc can mirror a file.

Specs, runbooks, meeting notes and architecture decisions are the things that
end up here.

## Standup

A board rather than a meeting. Each person gets a column showing what they
finished, what they are on, and what is blocking them, built from the issues
themselves rather than from what someone remembers to type.

There is a timer, a rotation so the same person does not always go first, and
blockers can be raised and resolved as first class things.

Agents can run standup through the MCP server, which is how a bot can post it to
Slack without anyone opening Orbit.

## Views and filters

A **filter** narrows what you are looking at: team, state, assignee, label,
project, sprint, priority, estimate, dates, and combinations of those.

A **saved view** is a filter you named and kept. Views are shared with the
workspace or private to you, and a private view is delivered to its owner alone
over the realtime stream.

Views are the thing to reach for when you keep re-applying the same three
filters. `Bugs in progress with no assignee` deserves to be a view.

## Inbox and notifications

The inbox collects what happened that involves you: assignments, mentions,
comments on issues you follow, state changes on work you are watching.

Notification preferences are per event type, with quiet hours that respect your
timezone. You can be notified in the app, by email, or in Slack.

## Realtime

Everything above is live. When someone changes something, the change writes to
Postgres, publishes to Redis, and fans out over a websocket to everyone whose
scope entitles them to see it. No refresh, no polling.

The delivery scope matches the read permission, so a private view goes to its
owner alone, and a project belonging to a team goes to that team. If you can see
it, you get it live. If you cannot, it never reaches your browser.

[Architecture](architecture.md) has the mechanism.

## Keyboard first

Orbit assumes you would rather not use the mouse. <kbd>Cmd</kbd> <kbd>K</kbd>
opens the command palette, `g` then a letter navigates, and single keys act on
what is selected. Press <kbd>?</kbd> for the list.

[Keyboard shortcuts](keyboard-shortcuts.md) has all of them.
