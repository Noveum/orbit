# Concepts

The vocabulary Orbit uses, and what each thing is actually for. If you have used
any other issue tracker most of this will be familiar, and the places where
Orbit differs are called out.

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
priority, an assignee, multiple reviewers, labels, an estimate, and relations
to other issues. Reviewers are subscribed automatically, and reviewed work
appears in their My issues page alongside work assigned to them.

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
the one that changes behaviour: an issue blocked by another is flagged wherever
it appears, so the block is visible before anyone plans around it.

### Estimates

Points, on the usual scale. Optional. Sprints can track scope by issue count or
by points, and analytics shows both.

## Labels

Tags with a colour. A label is workspace wide by default, which is what makes it
useful for things like `Bug`, `Performance` or `Docs`, and they are the main
thing filters and saved views are built from.

A label can instead be pinned to one team. A team label is only visible to that
team, only pushed over realtime to that team, and only attachable to that team's
issues. Pinning a workspace label to a team also takes it off the issues of every
other team, so the rule holds for issues that already carried it rather than only
for the next edit. Widening a team label back to the workspace touches no issue.
Carrying an issue to another team works the same way round: the labels the new
team cannot use come off it as it lands, and the workspace-wide ones stay.
Manage both under **Settings**, **Labels**.

Two labels may share a name when they live in different places, a workspace
`Regression` alongside a team `Regression`. The API and the settings screen take
ids, so that is unambiguous, but a name given to an MCP tool is not: when more
than one label answers to it, the tool refuses and lists the ids rather than
picking one.

## Workflow states

The columns of a team board. Each one belongs to a single team, carries a
position that fixes its place in the order, and carries a **category**, one of
`triage`, `backlog`, `unstarted`, `started`, `review`, `completed` or `canceled`.

The category is the part the rest of Orbit reads. It is what decides whether an
issue counts as open on a sprint burndown, when `startedAt` and `completedAt`
are stamped, and which bucket the standup board puts it in. Renaming a status or
moving it in the order leaves the category alone; changing the category re-dates
every issue sitting in that status, on the server, in the same transaction. Those
issues did not move, so how long they have sat where they are is left alone.

Deleting a status that still holds issues is refused until you name the status
those issues move to, and a team always keeps at least one status. Manage them
under **Settings**, **Workflow**.

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

Markdown documents with a rich editor, or a self-contained HTML page, living
beside the issues they describe rather than in a separate tool.

- Organised into **collections**, and nestable.
- **Visibility** is workspace-wide, private to named people, or a published URL.
- **Shareable** through a members link that still requires sign-in, or a public
  or unlisted link for people outside the workspace. An HTML page gets its own
  URL and runs isolated from the app.
- Commentable, and searchable alongside issues from the command palette.
- Optionally bound to a path in a repository, so a doc can mirror a file.
- A fenced `mermaid` block is drawn as a diagram, in the theme's own colours,
  with the source one click away. The rich editor previews it as you type.
- Import a `.md` or `.html` file. HTML stays as one file, not a project.

Specs, runbooks, meeting notes and architecture decisions are the things that
end up here.

## Standup

A Kanban board of the whole workspace, with everyone's name in a row of tiles
along the top. Click a name and the board filters to work assigned to or reviewed
by that person. Click it again, or click Everyone, and you are back to the whole
team.

That is the entire feature. There is no meeting object, no turn order and no
timer, because the meeting already has a facilitator and they do not need
software to tell them whose turn it is. What they need is one screen that shows
what a given person is carrying, in the order the work moves.

Each tile carries a count of the open work that person owns or reviews, so you
can see who is loaded before anyone speaks.

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

It opens on **Activity**, which is everything people did: comments, replies,
mentions, reactions, reviews, failed checks, document changes. Issue field moves
such as `ENG-3 moved to In Progress` and assignments live on the **Status** tab
instead, so a busy board cannot bury a comment. The two tabs are complements, so
nothing is hidden, and Unread, Mentions and Pull requests still span both.

In-app notification preferences are per event type, with quiet hours that
respect your timezone.

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
