# Agent collaboration implementation design

Updated 2026-10-02.

This document describes the Personal Agent capabilities in the current code, how they operate, and the product workflows that remain incomplete. It supports design review of #215 and the current pull request. Workspace Agents, execution dispatch, and Sessions are not presented as existing capabilities.

The implementation gives external MCP agents stable identities and distinguishes the Agent Actor from the authorizing human on integrated Issue operations. OAuth, lifecycle controls, server authorization, and reliable event delivery are implemented. Complete Web Issue actor reading, agent assignment, and Human Owner interaction still have gaps. The implementation therefore does not yet complete every #215 workflow.

## Review context and code baseline

| Item | Baseline |
| --- | --- |
| Implementation branch | `feature/issue-runtime` |
| Implementation commit | [203a066](https://github.com/yxr-2025/orbit/commit/203a066dcba7c7ffc4adcb5a28e81749f3392e79) |
| Incorporated upstream baseline | `d133153ef077637324f0eb34b79fbc82f45b1212` |
| Review entry point | [PR 512](https://github.com/Noveum/orbit/pull/512) |
| Document status | Current implementation and remaining work, not proof of production readiness |

Source references use this fixed implementation commit so later branch updates do not silently change the code described here.

The starting problem is [Issue 215](https://github.com/Noveum/orbit/issues/215). MCP agent actions were attributed to the authorizing human. Teams could not distinguish the actual actor, assign an agent independently, or centrally revoke its access.

The first step uses Personal Agents. A member explicitly authorizes their own external agent, and Orbit records its stable identity, authorizing human, Grant, and Issue responsibilities. Team sharing and execution dispatch are outside the current implementation.

The terminology, rules, scope, and gaps needed to understand this implementation are included here. The [target design](./agent-collaboration-target-design.md) separately describes the long-term proposal and next delivery stage. It is optional further reading, not a prerequisite for understanding this document.

## Delivery scope

Members bring their own Personal Agents to Orbit over MCP. An external environment runs the agent process, and Orbit receives its tool requests.

The integrated Agent Issue write tools are `create_issue`, `update_issue`, `move_issue`, `archive_issue`, `unarchive_issue`, `delete_issue`, `set_relation`, and `remove_relation`. These paths use the agent identity, Human Principal, and exact Grant binding.

Comments, attachments, documents, projects, sprints, labels, workflow states, membership management, and workspace management retain the existing Human Principal paths. Existing authorization checks still apply. These operations do not yet have Agent attribution.

An agent has no separate User account, seat, Workspace Role, or Team Membership. Its identity adds no administrative privileges. Grant scopes and the authorizing human's permissions still determine whether existing non-Issue MCP tools are available. This stage does not prohibit every administrative tool already available to that human, nor does it add Agent attribution to those tools. Maintainers need to explicitly accept this scope.

There is no Workspace Registration, shared invocation, Delegation table, Agent Session, Runtime Binding, automatic wake-up, or execution progress. The database file named `agent-runtime.ts` defines idempotency and Outbox data, not an agent execution environment.

## Domain relationships

| Concept | Current meaning |
| --- | --- |
| Agent Identity | Stable workspace actor with a name, avatar, Owner, Client, and lifecycle information |
| Agent Owner | Human member who creates and authorizes the Personal Agent |
| MCP Client | External application initiating the OAuth connection |
| MCP Grant | Revocable, replaceable authorization binding Identity, Client, Human, Workspace, and scopes |
| Actor | Human or Agent performing an integrated operation |
| Principal | Authorizing human behind the agent, currently the Agent Owner |
| Issue Creator | Actor that creates an Issue, without automatically taking final responsibility |
| Issue Assignee | Current executor, either Human, Agent, or unassigned |
| Issue Owner | Human responsible for the result; nullable except when there is an Agent Assignee |

Agent Owner and Issue Owner may differ. The former controls Personal Agent authorization and use. The latter owns the work item's goal, blockers, and acceptance.

`connected` means there is a valid authorization connection. It does not mean the external agent process is online. Last connection use, last successful Issue action, and execution progress are separate facts.

## Current architecture

```text
Already-running external agent
    -> MCP HTTP request and OAuth token
    -> Exact Grant and Agent Identity validation
    -> Current Human Principal and Shared Policy
    -> Integrated Issue Module
    -> PostgreSQL transaction
         Issue / Activity / Audit / Notification / Outbox
    -> Outbox delivery
    -> Redis / Realtime / human clients
```

| Module or adapter | Current responsibility | Main implementation |
| --- | --- | --- |
| Consent Module | Explicit Identity selection or creation, trusted Consent validation, atomic Grant rotation | `packages/core/src/auth/agent-identity-service.ts`, OAuth decision route |
| MCP Authentication Adapter | Exact Access and Refresh Token Grant binding and current authorization | `packages/core/src/auth/mcp-token.ts` |
| MCP Tool Adapter | Resolve `me` and `agent`, route integrated tools to Agent Issue paths | `packages/mcp-server/src/tools` |
| Agent Issue Context | Resolve Membership, Identity, Grant, and Principal again inside the transaction | `packages/core/src/work/agent-issue-context.ts` |
| Shared Policy | Check scopes, current human permissions, and resource access | `packages/shared/src/policy/agent-issue.ts` and existing resource policies |
| Issue Responsibility | Compute responsibility relationships, check Personal Agent eligibility, clean invalid open relationships | `packages/core/src/work/issue-responsibility.ts` |
| Canonical Actor Reader | Read Human and Agent references into a common Actor View | `packages/core/src/work/issue-actor-view.ts` |
| Outbox Module | Transactional event staging, lease-based claiming, retries, and redaction before publication | `packages/core/src/realtime/issue-outbox.ts` |
| Persistent Outbox Worker | Continuous draining and Redis publication | `apps/realtime/src/outbox-worker.ts` |

The Responsibility Module extracts common calculations and cleanup, but Owner transfer, some notifications, and orchestration remain in `issue-service.ts`. The target interface is `assignIssue`, `unassignIssue`, `transferIssueOwner`, and `reconcileIssueResponsibilities`. Centralized orchestration through that interface is not yet complete.

## Identity and authorization

### OAuth Consent

Ordinary Orbit login does not create an agent. During MCP OAuth, the member selects a Workspace, confirms scopes, and explicitly selects their own Identity or creates a Personal Agent.

The server reads Client, redirect, and scopes from a trusted Verification Record. Submitted UI choices cannot replace the authorization scope. An existing Identity must belong to the current Workspace and Owner, match the Client, and be usable.

Reauthorization preserves the Identity and history, revokes its old Grant and credentials, and creates a new Grant. A shared Client must not cause connections for other Workspaces or Identities to be revoked.

An Identity is permanently bound to its first MCP Client. Changing Client requires a new Identity. Grant rotation does not allow an arbitrary Client or execution platform to take over an existing identity.

### Exact token binding

Tokens, Authorization Codes, and Refresh flows bind to a specific `mcp_grant_id`. Requests must pass consistency checks across Token, Grant, Identity, Owner Membership, and current Principal.

Legacy Grants without an Identity are retained as frozen history, and their credentials are revoked. Continued use requires new explicit Consent and a bound Grant. Orbit neither infers identities from Client names nor falls back to a Human Actor when an agent is missing.

### Current permission ceiling

```text
Effective Permission
    = Grant Scope
    ∩ Agent Owner's current permissions
    ∩ Resource Policy
```

The server evaluates current state. A role at token issuance or a historical snapshot cannot preserve access that has since been lost. MCP scopes select the tool set; specific operations still require Core and Shared Policy checks.

Agent Issue mutations lock relevant records and recheck state inside the transaction. Membership, Identity, Grant, and Issue use a consistent lock order so lifecycle operations and writes do not introduce conflicting orders.

Profile editing and some lock-release rules still contain authorization branches directly in Core. They have server checks, but Policy centralization is incomplete. This is not a claim of a verified privilege escalation, nor evidence that every Shared Policy structural requirement has been met.

### Current identity count limit

The implementation limits each member to two Active Identities per Workspace inside a transaction. Active but disconnected Identities count; disabled and deleted Identities do not. Creation and resumption lock the Member row.

This implementation limit conflicts with upstream `CONTRIBUTING.md`, which excludes usage limits. It needs a maintainer decision. It is not a seat or billing mechanism, and it must not be presented as an accepted permanent upstream policy.

## Issue data and workflows

### Separate Human and Agent references

Issues add separate Human and Agent Creator and Assignee references, plus a Human Owner reference. Legacy Human fields remain during the transition.

| Relationship | Database requirement |
| --- | --- |
| Creator | Exactly one Human or Agent reference is non-null |
| Assignee | At most one Human or Agent reference is non-null |
| Owner | Human reference only |
| Agent Assignee | Requires a Human Owner |
| Workspace | Issue, Agent, and Grant cannot be mismatched across Workspaces |
| Active Grant | At most one valid Grant per Identity |

Human writers dual-write compatibility fields. Agent writers use Agent references and leave legacy Human fields null. Agent IDs must not be placed in User foreign keys.

The canonical reader returns `creator`, `assignee`, and `owner`. Actor Views include `type`, `id`, `name`, `avatar`, and `deleted`. This server read model exists, but client parsing and rendering are not fully connected.

### Creation and assignment

Omitting Assignee or passing null creates an Unassigned Issue. The current Actor is the default Creator; Owner and Assignee are otherwise empty.

The first explicit Human assignment initializes an empty Owner to that Human. The first explicit Agent assignment initializes an empty Owner to the Agent Owner. Changing Assignee does not overwrite an existing Owner.

Only the Agent Owner or that Agent itself may establish a Personal Agent assignment. Administrative governance does not grant assignment or invocation rights. Other members with Issue edit permission may remove or replace an existing Agent Assignee.

Human Assignee, Agent Owner, and Issue Owner must be able to read the target Issue when establishing a relationship. Cross-Team moves validate the final relationships in the destination Team and reject atomically if invalid.

Controlled Human Owner transfer has a server path. Agents cannot transfer human responsibility. Explicit Owner clearing, Web Owner display, and Web transfer controls remain incomplete.

### MCP query semantics

| Input or tool | Current meaning |
| --- | --- |
| `me` | Current Human Principal |
| `agent` | Agent Identity of the current connection |
| `list_my_issues` | Existing Human Principal participation view as Assignee or Reviewer |
| `list_agent_issues` | Issues assigned to the current Agent |
| `search_issues` with `assignee = "agent"` | Current Agent assignment query |

MCP does not expose arbitrary Agent name or ID lookup for assigning another person's Personal Agent.

These tools establish or read work assignments. An Agent Assignee does not start a process, send execution instructions, or create a Delegation or Session. Natural-language delegation happens in the Owner's conversation with their already-running external agent.

## Lifecycle and history

Identity lifecycle and authorization connection are separate:

```text
lifecycle = active | disabled | deleted
connection = connected | disconnected
```

| Action | Current result |
| --- | --- |
| Pause | Set an independent Owner or Admin lock, revoke Grant and credentials, clear open Agent assignments |
| Resume | Release only an authorized lock and recheck the Active limit; requires reauthorization and does not restore cleared assignments |
| Revoke Connection | Revoke connection and credentials, retain Identity, clear open Agent assignments |
| Delete | Write an irreversible tombstone, revoke connection, clear open Agent assignments, retain valid Human Owner and history |
| Owner leaves Workspace | Tombstone Personal Agent, invalidate authorization, clean invalid open responsibilities; do not transfer Identity or Grant automatically |
| Resource read access lost | Clean invalid open Owner, Assignee, and Reviewer relationships; clearing Owner cannot leave an Agent Assignment without a Human Owner |
| Only write access lost | Retain Assignment while read access remains valid, reject subsequent mutations |

Owner and Admin locks do not overwrite one another. Unlocking checks the relevant operator. Agent references and attribution on closed or canceled Issues remain historical records.

Pause, revocation, and deletion stop subsequent Orbit requests. They cannot terminate an external agent process or retrieve data already sent outside Orbit.

Physical User deletion must respect historical foreign keys and retention procedures. Agent Owner and Principal name snapshots survive the authorizing account. User foreign keys must not all be treated as freely cascade-deletable.

Member removal currently lacks a preview and confirmation of affected Agent, connection, and open assignment counts. Server cleanup exists, but the UI for understanding those consequences in advance is incomplete.

## Attribution and notifications

Integrated Issue paths persist Actor, Human Principal, Grant, and name snapshots at the time of the action. Assignee activities use structured Human or Agent ActorRefs, with compatibility for historical `assigneeId` activities.

Agents are not Human Subscribers, Reviewers, or Issue Owners. Activity, Inbox, and public Realtime payloads may display the Agent and necessary authorizing-human information, but not tokens or internal Grant IDs. The Agent's own `get_me` and restricted Owner or Admin Settings may expose necessary Grant metadata.

`lastUsedAt` records connection use. `lastActedAt` records a successfully committed Issue action. Read-only calls, failures, and rollbacks are not evidence of completed work.

A confirmed notification discrepancy remains. The intended behavior is a one-time notification to the Agent Owner on Agent self-assignment, without duplicates for the same assignment or idempotent replay, and without self-notification when the Owner performs the assignment. The current `assignmentRecipients` reads `issue.ownerUserId` for Agent assignments. When Agent Owner and Issue Owner differ, the recipient is wrong. Passing same-owner tests does not prove the distinct-owner case.

Issue tool coverage also needs completion. `mark_issue_duplicate` still uses the Principal and legacy publication path instead of Agent Issue Context. It changes Issue state and relationships and must be integrated or explicitly blocked for Agent use. This cannot be described as merely a missing non-Issue operation.

## Reliable writes and event delivery

Integrated Agent Issue writes stage the Issue change and required Activity, Audit, Notification, and Outbox records in one database transaction. A failed write leaves no partially successful product state.

A separate persistent Outbox Worker claims pending records with leases and retries failed publication. It recursively removes internal Grant IDs before publishing to Redis and existing Realtime channels. Requests may attempt a drain; the persistent Worker handles continuing delivery, with Cron as supplemental recovery.

Delivery is at-least-once. A crash after publication but before acknowledgment can duplicate events. Consumers deduplicate by Event ID and handle late events with Sync ID or Aggregate Version. They cannot depend on a global Worker order.

This Worker delivers Orbit events. It does not run models, start agents, receive an agent execution queue, or manage Agent Sessions. Its deployment adds a persistent process requirement without changing the Web application's Vercel Node runtime.

### Create idempotency

`create_issue` supports an optional camelCase `idempotencyKey`. Grant, Tool, and Key uniquely identify the record, which stores a normalized request hash and successful result with a default 24-hour retention.

The same key and request return the same successful result without duplicating the Issue or side effects. A different request with the same key conflicts. Replay still checks current authorization; a revoked agent cannot use a cached result to retain access.

The implementation does not promise business idempotency for all mutations or exactly-once message delivery.

## Visible surfaces and analytics

OAuth Consent and `/settings/mcp` are extended. Owners manage their own agents. Admins with `member:manage` can see a compact Workspace list and perform governance actions. The page distinguishes Identity, connection, granted scopes, and effective permission summaries.

Settings filters open Issue counts and recent activity by the requester's readable resources. Summaries do not guarantee permission for every Team or Issue; resource operations still require current authorization checks.

Activity and Inbox have Agent attribution, but core Issue detail, list, and board surfaces retain Human-only parsing and rendering paths. `issueSchema` does not preserve the full canonical Actor and Owner fields. Multiple surfaces still resolve a Human Member from `assigneeId`, so an Agent Assignee may appear Unassigned. Creator currently has a generic Agent marker without complete name, avatar, or deletion state.

Server analytics distinguishes Human, Agent, and Unassigned. Agent assignments are not attributed to the Agent Owner in People Analytics, nor considered Unassigned because the legacy Human Assignee field is null. Workspace, Team, Project, and Sprint totals still include Agent Issues.

A complete Agent directory, invocation statistics, error analysis, execution progress, and Session controls are not implemented.

## Migration and enablement

The candidate preserves official upstream migrations 0017 through 0029 and appends `0030_green_shaman.sql`, its snapshot, and journal entry. Supported starting states are a new database or an exact continuous official upstream migration prefix.

The early #215 development branch's duplicate-numbered migration lineage is unsupported. It was used for local development and acceptance, without a real-business-data deployment requiring an upgrade. This does not establish compatibility with arbitrary historical databases.

Human Creator, Assignee, Owner, and historical Principal data are backfilled from legacy records. Migration does not invent Agent history, send notifications, or manufacture product operations.

`agent-actors.sql` supports repeatable data reconciliation on the current Agent schema. It does not replace missing official migrations or infer a ledger from schema appearance. Drift Guard now checks CHECK constraints and key lifecycle constraints.

Four process-wide gates default off and enable only for the exact value `true`:

| Gate | Purpose |
| --- | --- |
| `ORBIT_AGENT_IDENTITY_READ` | Identity reading stage |
| `ORBIT_AGENT_CONSENT` | New authorization stage |
| `ORBIT_AGENT_ISSUE_WRITE` | Agent Issue writing stage |
| `ORBIT_ISSUE_OUTBOX_DISPATCH` | Event delivery stage |

Agent writing requires all four gates. Migration, historical backfill, compatibility across all readers, and Worker preparation must precede writing. The Web reader gap must still be closed.

After Agent data exists, safe rollback disables Agent writing while retaining compatible readers and Outbox delivery. It does not restore an old binary that cannot understand Agent references or delete tables to erase history.

## Implementation status

| Capability | Code status | Remaining work |
| --- | --- | --- |
| Identity, Grant, Token, tombstones | Implemented | Maintainer decisions on self-service creation, fixed Client binding, and count limit |
| Consent, independent locks, lifecycle | Implemented | Centralize remaining Core authorization branches; member-removal preview |
| Agent Context for listed Issue MCP tools | Implemented | Inventory all other Issue mutations and handle duplicate paths |
| Server dual Actor references, Owner, canonical reader | Implemented | Client schemas and all Issue surfaces |
| Owner initialization and controlled transfer | Partial | Web display and controls; controlled Owner clearing |
| Web Personal Agent assignment | Incomplete | Owner-only picker and complete negative server tests |
| Agent assignment notification | Implementation defect | Notify Agent Owner; test distinct Owners |
| Activity, Inbox, Realtime attribution | Main paths integrated | Complete Creator and Owner activity display; check tool coverage |
| Outbox, Worker, create idempotency | Implemented | Target deployment validation, failure alerts, operational ownership |
| Workspace Agent, Registration, Delegation, Session | Not implemented | Future proposals, not current capabilities |

## Validation evidence and limits

The following is the author's reported acceptance summary for the fixed implementation commit. Full raw logs are not published as attachments here, so these are not independently verified results for an external reader. These suites were not rerun merely to prepare this document.

| Validation | Reported result |
| --- | --- |
| Full Linux `bun run verify` | 6534 passed, 0 failed; all nine workspace packages executed |
| Ordinary browser E2E | 57 passed, 0 failed, 3 existing skips; 60 total |
| Two-stage HTTP MCP E2E | Writer-on and Writer-off in a fresh process passed |
| Isolated empty-database CLI release, repeat release, drift | 31 migrations initially applied; 0 pending on repeat; drift passed |
| Linux Web production build | Passed with local validation configuration |
| Documentation build and navigation | Passed |
| Real S3 round-trip | Included in that verify run with signature validation enabled |

Some persistent Worker image and process-recovery evidence comes from earlier commits and was not all rerun at this SHA. This document does not validate final hosted CI, production OAuth, production S3, production database upgrades, the public network endpoint, or deployment.

Green suites establish the tested scenarios. They do not remove the Web gaps, distinct-owner notification defect, or Issue tool coverage omission. Local success is not a claim that the change can be merged, closes #215, or has production use.

## Implementation evidence index

These links use the fixed implementation commit in the PR source repository. They expose source and committed operational documents without requiring local files.

- [Identity and authorization schema](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/db/src/schema/oauth.ts), [Issue schema](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/db/src/schema/work.ts), [idempotency and Outbox schema](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/db/src/schema/agent-runtime.ts)
- [Consent and lifecycle](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/auth/agent-identity-service.ts), [token validation](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/auth/mcp-token.ts)
- [Agent Issue Context](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/work/agent-issue-context.ts), [Shared Policy](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/shared/src/policy/agent-issue.ts)
- [Canonical Actor Reader](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/work/issue-actor-view.ts), [Responsibility behavior](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/work/issue-responsibility.ts), [Issue writes and notifications](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/work/issue-service.ts)
- [MCP Issue tools](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/mcp-server/src/tools/issues.ts), [MCP current identity](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/mcp-server/src/tools/identity.ts)
- [Client Issue schema](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/shared/src/validators/issue-response.ts), [Issue properties](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/apps/web/src/features/issues/issue-properties.tsx), [member-removal surface](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/apps/web/src/features/settings/members-table.tsx)
- [Outbox delivery](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/core/src/realtime/issue-outbox.ts), [persistent Worker](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/apps/realtime/src/outbox-worker.ts), [feature gates](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/shared/src/agent-feature-gates.ts)
- [Official additive migration](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/db/drizzle/0030_green_shaman.sql), [repeatable data reconciliation](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/packages/db/catchup/agent-actors.sql)
- [Migration compatibility](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/docs/agent-migration-compatibility.md), [release runbook](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/docs/issue-215-release-runbook.md), [Worker deployment](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/docs/outbox-worker-deployment.md), [contribution policy](https://github.com/yxr-2025/orbit/blob/203a066dcba7c7ffc4adcb5a28e81749f3392e79/CONTRIBUTING.md)
