# Docs area rework, board drag and drop, and board load speed

Date: 2026-08-07
Branch: `claude/docs-area-redesign-2a2395`
Delivery: one pull request, small scoped commits in the order below.

## Why

Three complaints, all reproducible in the current code.

1. The docs sidebar organises by collection, but nothing in the tree lets a
   person put a doc into a collection. The only affordance is an unlabelled
   folder icon in a header packed with twelve icon buttons, so in practice every
   doc piles into "Project docs" or "Private" and every collection reads
   "Nothing here yet". Docs also nest under other docs, so a page that has
   children looks exactly like a folder, which is why folders feel like pages.
2. Cards cannot be dragged between columns on saved views or on a project
   board, because both pass `draggable={false}` to `Board`. On a team board
   dragging exists but switches off whenever the ordering is not manual, and
   the motion during a drag is unpolished.
3. Issues take upward of ten seconds to appear. Saved views and All issues walk
   a single cursor paginated list one hundred rows at a time, sequentially,
   driven by scroll sentinels.

## Scope

Six workstreams, one pull request.

- A. Docs: collections become real folders, with drag and drop.
- B. Docs: reading and editing polish.
- C. Docs: search, archive, and delete.
- D. Docs: sharing, copy link, and access requests.
- E. Board: drag and drop on every board surface.
- F. Board: load speed.

Out of scope: the published `/d/<token>` reader beyond what the shared prose
styles change, realtime protocol changes, and anything on the issue detail page.

## A. Collections become real folders

### Data

`doc_collection` gains `position` (double precision, not null, default 0) so
folders carry a manual order rather than falling back to creation time.

`doc` gains `sort_order` (double precision, not null, default 0) so pages carry
a manual order inside their parent. Ordering values are produced by the existing
`sortOrderBetween` helper in `packages/shared/src/utils`, the same one issues
use, with the same rebalance threshold behaviour when two neighbours converge.

No new table. Collections stay one level deep, as they are in Plane.

### Invariants, enforced server side

A collection is a container and never a page. It has a name, an icon, and a
position, and it holds no content, so nothing in the product can open one.

A doc has exactly one home: a collection, a project, or Private, which is the
absence of both. `updateDoc` enforces the pairing rather than trusting the
client:

- Setting `parentId` makes the doc inherit the parent's `collectionId` and
  `projectId`, and the same rule cascades to that doc's own descendants, so a
  subtree can never straddle two folders.
- Setting `collectionId` on a doc that has a parent in a different collection
  clears `parentId`, which promotes the doc to the top level of its new folder.
- A doc may not become its own ancestor. The existing `descendantIds` guard in
  the UI moves to the service as the authority, and the UI keeps its copy only
  to grey out impossible targets.

Deleting a collection keeps its docs and moves them to Private, which is what
`on delete set null` already does. That behaviour stays, and the confirmation
copy says so.

### Sidebar

Folder rows and page rows stop looking alike. A folder row shows a folder glyph
plus its icon, a disclosure chevron, a count, and its own actions. A page row
shows a page glyph. Only page rows are links.

Drag and drop uses `@dnd-kit/core` and `@dnd-kit/sortable`, already a
dependency, with a pure planner so the rules are testable without a DOM:

```
planDocDrop(tree, activeId, over): DocMove | null
```

where `over` carries the target row and whether the pointer is on the upper
edge, the lower edge, or the middle of that row. Upper and lower edges reorder
next to the target and adopt the target's parent. The middle of a page nests
under it. The middle of a folder header moves to the top of that folder. A drop
that would nest a doc inside its own subtree returns `null`.

While dragging, a two pixel line marks a reorder target and the folder row
highlights for a move target. Motion is transform and opacity only, at the
existing token durations, and disabled under `prefers-reduced-motion`.

Every row gains a `...` menu: Rename, Move to, Duplicate, Copy link, Archive,
Delete. Move to opens the same searchable picker that the header uses today, so
keyboard users are not forced into a drag.

## B. Reading and editing polish

One prose stylesheet, `docProseClassName`, already shared by the reader and the
markdown preview, is extended to the rich text editor so writing and reading
agree. Changes:

- Heading scale and vertical rhythm reworked, with the first heading in a
  document not carrying a top margin.
- Body measure fixed at roughly 45rem, the reader column and editor column
  matching.
- Lists tightened, task list checkboxes aligned to the first line of text.
- Tables wrapped in an `overflow-x: auto` container with a sticky header row,
  so a wide table scrolls itself and never the page.
- Code blocks get a language chip and a copy button, both keyboard reachable.
- Blockquote and callout treatments distinguished from each other.
- Headings get a hover anchor link that copies a deep link.
- Images get optional captions from their markdown title.

The doc header is restructured. Today it holds twelve controls in an eleven
pixel tall row, which is why the move affordance is invisible. It becomes:
breadcrumb and title on the left, save status, then Share, a single `...`
overflow holding duplicate, export, history, move, nest, archive and delete,
and New doc. The overflow is a menu, so every action gets a label.

## C. Search, archive, and delete

### Search

Server side, `listDocs` moves off `ILIKE '%term%'`:

- A generated `tsvector` column on `doc` weights the title as `A` and the
  content as `B`, with a GIN index.
- Ranking is `ts_rank_cd` over that vector, tie broken by `updated_at`.
- Snippets come from `ts_headline` rather than the current naive truncation, so
  the excerpt contains the match instead of the first hundred and forty
  characters of the document.
- The existing trigram indexes stay and serve short terms, prefix terms, and
  terms that produce no lexemes, so a two character query still works.

The client search input opens a results panel instead of replacing the tree with
a flat list. Results are grouped into title matches and body matches, each row
carrying its folder breadcrumb and a highlighted snippet. Up and down move the
selection, enter opens, escape closes and restores the tree. An include archived
toggle sits in the panel footer.

### Archive and delete

`archiveDoc` already accepts an `archived` flag that no route passes, so the
restore path is one route away. Added:

- `POST /api/docs/[id]/restore` calls `archiveDoc(principal, id, false)`.
- `DELETE /api/docs/[id]?permanent=1` calls a new `deleteDoc`, which hard
  deletes and is allowed for the author or a workspace admin only. Versions,
  comments, access rows and access requests cascade.

The sidebar grows an Archived section pinned to the footer, listing archived
docs with Restore and Delete forever. Archiving from a row raises a toast with
an undo that calls restore.

## D. Sharing, copy link, and access requests

### Copy link

`publicDocUrl` returns `null` for anything that is not published, which is why
the copy button disappears on a private doc. A new `appDocUrl(docId, origin)`
returns `/docs/<id>` and the copy control uses it always, at every visibility.
The published URL stays available alongside it when a token exists.

### One share dialog

The dropdown, the segmented control and the separate people dialog collapse into
a single dialog: a visibility list with descriptions, the people and team access
list with an add row, the in app link with a copy button, and Reset link shown
only when a publish token exists.

### Request access

New table `doc_access_request`:

| column | type | notes |
| --- | --- | --- |
| id | text primary key | `randomUUIDv7()` |
| organization_id | text not null | cascade |
| doc_id | text not null | cascade |
| requester_id | text not null | cascade |
| message | text | optional, capped at 500 characters |
| status | text not null | `pending`, `granted`, `declined` |
| decided_by_id | text | set null |
| decided_at | timestamptz | |
| created_at | timestamptz not null | |

Unique on `(doc_id, requester_id)` where status is `pending`, so a person cannot
spam the owner.

A member of the workspace who opens a doc they cannot read gets a screen naming
the doc title and its owner with a Request access button. The endpoint that
backs that screen returns the title and the owner only, never content, and only
to a principal in the same organisation. Everyone else keeps the existing not
found response, so the endpoint cannot be used to probe another workspace.

Granting creates a `doc_access` read grant for the requester and marks the
request granted. Two notification types are added, `doc_access_requested` to the
owner and `doc_access_granted` to the requester, delivered through the existing
inbox and email channels.

## E. Board drag and drop

### Turning it on

`saved-view-page.tsx` and `project-issues.tsx` both hardcode
`draggable={false}`. Both pass a real value, and both pass
`resolveState={mergedStateResolver(workspace.states)}` when grouping by state,
so a card dropped on a merged column lands on that team's own state row rather
than on a synthetic merged id.

`team-view.tsx` computes `draggable={canRegroup(groupBy) && orderBy ===
'manual'}`, which switches dragging off entirely under any other sort. That
splits into two capabilities: a card may always be dragged between columns when
the grouping is regroupable, and it may only be reordered within a column when
the ordering is manual. `planDrop` already produces both a regrouping patch and
neighbour ids, so under a non manual ordering it emits the regrouping and drops
the neighbours.

Empty columns show by default in board layout everywhere. The default already
reads `showEmptyGroups: layout === 'board'` but `applyCapabilities` can clear
it, so the capability is granted on every board surface, and a state with no
issues renders as an empty column that accepts a drop.

### The card that does not land where it was dropped

Two separate causes, both in the cache rather than in the pointer handling.

First, `reconcile` in `use-issues.ts` refuses to insert a row into any list
whose search carries a `filter` parameter, through `admitsNewRows`. A board
under any filter therefore removes the card from the source column, never adds
it to the destination, and leans on `settleFilteredLists` to invalidate and
refetch. The card is simply absent until the server answers, which on a slow
board is the several seconds being described. The optimistic move instead
writes the row into the destination column's cache directly, keyed by the same
`columnSearch` the destination column reads, and reconciles against the server
response when it arrives. A filtered list still drops a row that genuinely
stops matching, but only once the server has said so.

Second, a destination column that has never been fetched has no cache entry, so
`setQueryData` is handed `undefined` and returns it, and the write is lost. The
optimistic path seeds an empty page for a destination column that has no entry,
so the card has somewhere to land. This is also why empty columns need to exist
before a drop can work, which ties back to `showEmptyGroups`.

The visible churn after a successful drop comes from `onSettled` calling
`resortTeamIssueLists` across every cached list plus `refreshCounts`, which
resorts rows under the pointer immediately after the drop animation. The resort
is narrowed to the two affected columns and deferred until the drop animation
has finished.

Board rendering during a drag is also noisier than it needs to be. Every column
publishes its rows through `setColumnRows` in an effect, which allocates a new
`Map`, which recomputes `loadedGroups`, `issues`, `childCounts` and `lookups`,
which re-renders every card on the board. Row publishing moves to a ref that is
read when a drag starts, so a drag no longer re-renders the whole board.

### Feel

- Collision detection becomes `pointerWithin` with a `rectIntersection`
  fallback, so a column is hit by pointer position rather than by card corner
  proximity, which is what makes a sparse column hard to hit today.
- A placeholder opens a gap at the landing position instead of cards snapping
  after the drop.
- The overlay card tracks the cursor without the current lift and rotation, and
  keeps a single shadow step.
- Auto scroll: horizontally when the pointer nears a board edge, vertically
  when it nears the top or bottom of a column.
- `cursor: grabbing` on the body for the duration of a drag.
- Keyboard: with a card focused, `Cmd` or `Ctrl` with left and right moves it
  across columns and announces the result through the existing dnd-kit
  announcer.
- All of it transform and opacity only, inside the shared tokens in
  `apps/web/src/lib/interaction.ts`, and inert under `prefers-reduced-motion`.

## F. Board load speed

### One request for the first screen

New `GET /api/issues/board`, taking the same filter, ordering and scope
parameters as `/api/issues` plus `groupBy` and a per group `limit`. It returns:

```
{ groups: [ { id, total, issues: Issue[], nextCursor } ] }
```

computed with a single windowed query,
`row_number() over (partition by <group key> order by <ordering>)`, filtered to
the first N rows per partition, rather than one query per column. Totals come
from the grouped count that `getIssueCounts` already performs.

### Parallel columns everywhere

The per column infinite query already exists as `useColumnIssues` but is wired
only to the team state board through `columnSource`. The board endpoint seeds
every column's cache on first paint, after which each column pages
independently and in parallel. `columnSource` is passed by saved views, All
issues and project boards, not only by the team board, and it stops being
restricted to `groupBy === 'state'`.

### First paint

The board query is prefetched on the server through the existing prefetch
module and hydrated, so the first paint carries rows instead of a skeleton. The
list layout keeps cursor pagination, with the sentinel moved a viewport ahead of
the bottom so the next page is in flight before it is needed.

### Evidence

Timings are measured against a seeded workspace of roughly five hundred issues,
before and after, and the numbers go in the pull request description. The claim
is not "it feels faster".

## Testing

A feature is not done until a test would fail if it broke.

`packages/core`

- Home invariants: nesting inherits the parent's collection and project, moving
  a doc into a collection detaches a foreign parent, a doc cannot become its own
  ancestor, deleting a collection moves its docs to Private.
- Ordering: `sortOrderBetween` placement for docs, and rebalancing when
  neighbours converge.
- Hard delete: author and admin may, anyone else may not, and dependents go.
- Access requests: creation, uniqueness while pending, granting creates the read
  grant, and the metadata endpoint refuses a principal from another workspace.
- Search: title beats body, ranking order, headline contains the match, short
  terms still return through the trigram path.
- Board query: partition limits, totals, and cursor continuity against the
  existing list endpoint.

`packages/shared`

- The doc filter and move validators, and the new notification types.

`apps/web`

- `planDocDrop` as a pure planner: every edge and middle case, and the refusal
  to nest into its own subtree.
- `planDrop` under a non manual ordering emits regrouping without neighbours.
- `appDocUrl` for every visibility, and the share dialog rendering a copy
  control on a private doc.
- Search panel grouping and keyboard selection.

`apps/web/e2e`

- Drag a doc into a folder and see it stay after a reload.
- Drag a card between columns on a saved view.
- Copy a private doc link, open it as another member, request access, grant it,
  and read the doc.
- Archive, restore, and delete a doc.

## Migrations

Three schema changes: `doc_collection.position`, `doc.sort_order`, the `doc`
search vector with its index, and the `doc_access_request` table. Per the repo
rules they are applied against the target database before the code that depends
on them ships, never by a job in the platform.

## Risks

The pull request is large. Commits are scoped one workstream at a time, in the
order A through F, so the review reads in sequence.

Moving docs search to `tsvector` changes result ordering for existing content.
The trigram path stays as the fallback, so no query becomes unanswerable, but
ranking will differ from today and that is the intent.

Enabling drag on surfaces that never had it means a stray drag can now move an
issue. Every move already goes through `useMoveIssue`, which is optimistic and
reversible through the activity trail, and the four pixel activation distance
stays.
