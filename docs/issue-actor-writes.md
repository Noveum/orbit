# Personal Agent Issue writes

This change builds on PR1, PR2 and both PR3 deployment stages. It implements
Personal Agent Issue writing and responsibility, without completing every
workflow in issue #215.

## Dependency baseline

The integration baseline is `84483b79f2755d479fd10a45542539c1881015cb`.
It contains upstream main `0a24d57c8ddda1fef449d73f29e85276dbdc1eba`,
PR1 `edcc0c6ac4c80fb1b6a95783b325ce0cb394a688`,
PR2 `349d39ce07ae81a69946590335d5c5e53178aa16`, and
PR3 `825e9e1d3e2268e105e4f2adf7be56177474e2fc`.
Predecessor commits are dependencies, not this change's implementation diff.

The dependency synchronization on 2026-10-08 adopts PR1's Owner revision
`c8cc14371937ce7bf9dcaaab778d93ec0050d939` and PR2's sidebar follow-up
`86e8b125a79bab3ed579ae025f22457a9de7424b`. The original integration and
Stage A/B commits are retained. This synchronization imports those focused
dependency changes without absorbing unrelated upstream main changes.

PR1 remains open and unmerged at that revision. Its `0030` SQL is preserved
byte for byte, with SHA-256
`e4c0f9da17988ac12dc53bc9e825d88dcea6e14a623330b003db190cfa36642b`.
The `0030` snapshot and journal entry have no schema change and are retained.
Official migrations `0000` through `0029` are unchanged.

## Stage A: write compatibility preparation

Migration `0033_issue_actor_write_compatibility` follows `0032` and makes
legacy `creator_id` nullable. New writers set canonical Human or Agent
references. The compatibility trigger mirrors Human references into legacy
columns and Agent references into legacy NULL. Changed canonical references
take precedence over changed legacy references. Unchanged legacy Human
writers continue to initialize and change Human references.

Explicit unassignment by an upgraded writer clears both canonical Assignee
references, including when legacy `assignee_id` is already NULL. Assignment
initializes an empty Issue Owner from the Human Assignee or the Personal Agent
Owner. Later reassignment or unassignment preserves the Issue Owner.

Release, baseline and trigger recovery install the latest committed compatible
function and trigger. Recovery preserves Agent references, existing Owner
values, business timestamps and Sync IDs. Historical migration files are not
rewritten after application. The still-unmerged `0030` is synchronized with
the current PR1 source as described above. Legacy columns and the expanded
foreign keys remain installed. Human mirrors on mixed Actor rows are
repaired independently. Neither the `0030` backfill nor baseline or recovery
infers an Owner, including for previously uninitialized Human references.
NULL and explicit Owner values remain unchanged. The `0033` responsibility
rule applies when a writer establishes a new assignment, rather than when
the migration or release repairs historical rows.

Real Agent-created Issues have `creator_id = NULL`. Shared response schemas,
REST, MCP, bootstrap, Realtime, cached rows and UI readers accept that value
and retain the canonical Actor display from PR2.

`ORBIT_AGENT_ISSUE_WRITE` defaults off and is enabled only by the exact value
`true`. It is independent of event delivery. Stage A does not enable Agent
write scopes or tools. `ORBIT_AGENT_MCP=true` can retain valid read-only Agent
connections while Issue writing is disabled.

## Stage B: authorization and responsibility

Agent consent defaults to read-only. A write checkbox is offered only when
the trusted OAuth request includes `orbit.write` and the Issue write gate is
enabled. Selecting it creates a new exact Grant version with that scope.
Existing read-only Grants and tokens never acquire it automatically. Token
exchange and refresh remain bound to the selected Grant, Client, Identity,
workspace and Owner Membership. An invalid Agent binding fails closed.
Legacy Human consent, token and refresh contracts remain unchanged.

The server constructs an Issue write context from the verified credential.
Tool arguments cannot supply its Grant, token, Client, Identity, Membership
or scope fields. Registration and invocation check the gate and tool policy.
Every Core Issue mutation checks again inside its transaction, locks the
current credential and binding, and resolves the Owner's current Principal.
Permission is the intersection of the Grant scope, current Human permissions
and each resource's policy. A removed Membership cannot regain an old Grant
by rejoining. Role, Team access, revocation and lifecycle changes are checked
at the write boundary. No authentication failure becomes a Human write.

The transaction takes the shared notification-policy lock before the MCP
Owner lifecycle lock, then credential and binding row locks. Issue rows used
by mutations are locked before resource authorization; relation pairs are
locked in stable order. This coordinates with existing policy/lifecycle
mutations and prevents a concurrent Team move from bypassing resource checks.
The current Team Membership query locks only Membership rows, avoiding a
shared lock on the Team counter before allocating an Issue number.

Creator is the actual Human or Agent executing the create. An Issue has at
most one Human or Agent Assignee. Its Human Owner is a separate relationship
from the Personal Agent's Owner. First assignment initializes a NULL Issue
Owner to the Human Assignee or Agent Owner; later replacement or removal
preserves it. Agent writes cannot transfer that responsibility. Only the
actual Human Owner or the same Personal Agent can establish that Agent's
assignment. Sharing a Human Owner does not authorize one Agent to assign
another. Editors can remove or replace an existing Assignee.

An assigned Human and the Agent's Human Owner must be current workspace
members who can read the Issue. A Team move validates the resulting Assignee,
Agent Owner and Issue Owner together and rejects invalid moves atomically.
Human creates retain their existing default self-assignment; an Agent create
without an assignment is unassigned.

## Input contract

Core create, update, bulk, sub-Issue and move schemas accept optional
`assigneeAgentId`. `assigneeId` retains its Human meaning. Two non-NULL
Assignee references are rejected. Omitting both preserves an existing
assignment; explicitly setting `assigneeId: null` clears an Agent assignment
even when its legacy mirror was already NULL. Owner and Creator are computed
by the server and are not caller-controlled mutation fields.

MCP assignment references use the existing `assignee` argument. Human IDs,
handles and `me` keep their meanings. `agent` means the connected Agent;
`agent:<identity-id>` names a Personal Agent and is subject to assignment
policy. `null` clears either kind. Human-only search filters retain their
existing contract. The Web interface continues to use the canonical Actor
reader from PR2; this change does not add a complete Agent selector UI.

## MCP mutation coverage

| Tool | Personal Agent policy |
| --- | --- |
| `create_issue` | Write scope, current Team permission, actual Creator, assignment policy |
| `update_issue` | Current Issue permission, assignment and retained Owner |
| `create_sub_issues` | Locked parent, every child authorized, one atomic transaction |
| `bulk_update_issues` | Every Issue authorized, one atomic transaction |
| `move_issue` | Source and destination permission, final responsibility validation |
| `move_to_cycle` | Context forwarded into Issue update; cycle and Issue policy |
| `archive_issue`, `unarchive_issue` | Locked current Issue and write permission |
| `delete_issue` | Current delete permission, all affected child/relation Issues authorized, actual Actor |
| `set_relation`, `remove_relation` | Both locked Issues authorized in one transaction |
| `mark_issue_duplicate` | Source, new survivor and previous duplicate endpoints authorized atomically |
| Comment create, edit and delete | Denied for Agent connections |
| Attachment add and remove | Denied for Agent connections |
| Other workspace, Team, project, document and planning writes | Denied for Agent connections |
| Inbox reads with write side effects | Denied for Agent connections |

The 12 allowed Issue mutation tools use the same trusted write context.
`get_agent_identity.readOnly` reflects available write capability. Turning
off the gate removes Issue write capability while keeping valid Agent reads
and refresh. Non-Issue operations do not receive Agent write access.

Activities, notifications and Realtime use the actual canonical Agent Actor.
Public payloads contain Actor references, never Grant IDs or credentials.
Agent self-assignment notifies its Human Owner, including when the Issue
Owner is someone else. Existing Human self-notification suppression remains.
Create, sub-Issue, update, bulk update and move establish persistent
subscriptions using the canonical assignment recipient. An Agent assignment
subscribes its Human Owner, so subsequent status changes reach that person.
Replacement or removal of an Assignee does not remove existing subscriptions.
The existing transaction and event-delivery architecture is retained; no
Outbox, permanent worker or separate idempotency subsystem is introduced.

## Review follow-up

Column moves collect the moving Issue, anchors and potential rebalance
candidates before taking any Issue row lock. The entire set is locked in
stable Issue ID order, and each locked row is authorized using its current
Team. A changed source Team or state, changed candidate column membership,
or a newly discovered candidate causes a conflict before column updates.
Rebalance uses the locked rows and rechecks the current candidate set, so
an Issue concurrently moved beyond the Owner's access is never updated.
The stable order also prevents two moves from holding different target rows
and waiting for one another through shared anchors and rebalance candidates.

Human sub-Issue creation preserves its existing independent number
reservation when the locked parent's Team matches the reservation Team.
If the parent moved meanwhile, it allocates from the current Team counter
after locking and authorizing that parent. The unused old Team reservation
remains a gap; it is never reused as a number in the destination Team.
Agent number allocation stays within the authorized write transaction.
Sub-Issues with cycle assignments acquire the cycle locks before updating
the counter. Parent and cycle checks precede an Agent create's counter
update for the same lock order to apply across create and move paths.

Human assignment undo and redo include both legacy `assigneeId` and
canonical `assigneeAgentId` in their expected state. A cached Human
unassignment cannot overwrite a newer Agent assignment merely because both
legacy Assignee values are NULL. The server rejects the stale operation as
a conflict and the client retains the intervening assignment.

Focused regression evidence for this follow-up is retained in the ignored
`.artifacts/` directory:

| Coverage | Evidence |
| --- | --- |
| Concurrent move beyond current access, allowed rebalance and Actor | `pr4-review-rebalance-red.log`, `pr4-review-rebalance-green.log` |
| Concurrent rebalance move lock ordering | `pr4-review-rebalance-concurrent-red.log`, `pr4-review-rebalance-concurrent-green.log` |
| Different Agent Owners creating together and moved-parent numbering | `review-counters-red.log`, `review-counters-green.log` |
| Persistent subscriptions, distinct Owners and Human notification behavior | `pr4-review-subscriptions-red.log`, `pr4-review-subscriptions-regression.log` |
| Actual Web undo and redo PATCH conditions | `review-undo-web-red.log`, `review-undo-web-green.log` |
| Server assignment conflict and unchanged responsibility on rejection | `review-undo-core-green.log` |

These logs establish focused behavior only. The subscription regression run
passed 145 tests; the Web history regression run passed 84 tests; the Core
undo run passed 11 tests. The final delivery record separately identifies the
independent review and full verification results for the exact source tree.

## Deployment order

An installation that manually applied the earlier unpublished `0030` hash
`be5f9ac8863434e90c9660ef83743e3a20bb1a0e14e463925de0cd2077f49f5e`
cannot use this checkout's release directly. Ledger validation fails closed
before pending migrations, and does not relabel its checksum or change Owner
history. Do not edit an applied ledger to bypass that check. A maintained
database needs an explicit forward correction release retaining its original
immutable migration lineage, with its data preserved and the upgrade tested.
A disposable local test database may instead be rebuilt from the current
chain. No production migration or checksum conversion is performed here.

1. Complete the separate PR3 compatibility and identity-binding rollout in
   [MCP grant rollout](./mcp-grant-rollout.md). Do not skip its stage 3a release.
2. Keep `ORBIT_AGENT_ISSUE_WRITE` off. Run `bun run db:release` and
   `bun run db:check-drift` from the stage A or newer checkout.
3. Upgrade every Issue reader and Human writer, including REST, background
   adapters, bootstrap, Realtime and MCP instances. Upgrade all consent,
   token exchange and refresh instances before offering Agent write consent.
4. Verify legacy Human writes and real-null Agent reader fixtures before
   authorizing any Agent to write.
5. After every reader, writer and OAuth instance has stage B or newer code,
   enable `ORBIT_AGENT_ISSUE_WRITE=true` on those instances. Explicitly
   reauthorize each intended Agent with the write checkbox, then verify an
   allowed Issue write and a read-only Grant rejection. Turning on the gate
   alone does not upgrade existing Grants.

## Rollback

Before Agent business rows exist, keep the expanded schema while recovering
the deployment. After Agent rows exist, disable `ORBIT_AGENT_ISSUE_WRITE`
first and retain a PR4 version capable of reading and editing those rows.
After write Grants exist, retain stage B token, refresh and consent support
even while writing is disabled. Stage A rejects writable Agent Grants and
is not a compatibility rollback for those credentials.
Do not directly roll back to PR2 or PR3. Old writers are not promised to safely
operate on existing Agent rows. Do not convert Agent history into Human
history, replace Agent IDs with User IDs or remove legacy columns.

## Local verification

Use a unique `ORBIT_TEST_LANE` for each concurrent suite. Prepare only the
owned lane databases with the real migration chain, not `db:push` or the
shared base test database reset. Migration and release tests execute old SQL
prefixes, actual upgrades, baselines and recovery against PostgreSQL.

Native Windows root tests depend on POSIX permissions, symlinks and Bash.
The local Linux verification image runs the same source snapshot with Bun
1.3.14 and a dedicated PostgreSQL 18 cluster. Test storage and Redis are local.
Logs are retained under the worktree's ignored `.artifacts/` directory.

Regression coverage includes every allowed MCP mutation, explicit consent
and exact binding, forged contexts, current permissions, revocation races,
cross-Team moves, assignment and Owner preservation, real Agent reader
paths, atomic bulk/sub-Issues, and notification recipient/Actor contracts.
SQL tests cover normal upgrades, old ledger states, baseline, repeated
release and missing/disabled/stale trigger recovery. The final delivery
record identifies each source tree, complete verification result and log.
