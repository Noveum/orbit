# Agent collaboration goals and staged design

Updated 2026-10-02. Product and design proposal for upstream review.

The long-term goal is to make agents identifiable, collaborative, governable, and accountable executors inside Orbit. Teams should be able to give an agent concrete work, see its contribution and execution state, and always identify the human responsible for accepting the result.

The first version lets members bring their own Personal Agents through existing MCP connections. Delegation control belongs to the Agent Owner; direct delegation by other members is not supported. Workspace Agents remain an explicit future direction for team sharing, requiring Owner consent, Workspace approval, caller permission constraints, and a separate execution model.

The background, terminology, security principles, and delivery boundaries are included here. Long-term entities and workflows are proposals, not capabilities implemented in the current PR. The [implementation design](./agent-collaboration-implemented-design.md) separately records actual behavior and gaps at a fixed code commit as optional implementation reference.

## Problem and scope

Existing MCP authorization binds Client, Human, and Workspace. Agent operations were attributed to the authorizing human. [Issue 215](https://github.com/Noveum/orbit/issues/215) asks for a separate Agent Identity so the executor, authorizer, assignment, and revocation controls can be distinguished.

This proposal starts with Owner-operated Personal Agents: Identity, exact Grant binding, current permission intersections, Issue Assignee, and Human Owner. Workspace Registration, Runtime Binding, Delegation, and Session follow in separate stages. Identity answers who acts; the later objects represent sharing eligibility, execution environment, work delegation, and an individual run.

The table defines first-version behavior. Long-term sections remain subject to review; this document does not imply maintainer approval of the full roadmap.

| Topic | Proposed design |
| --- | --- |
| Personal and Workspace | Different sharing states of the same Identity; approved Workspace Registration extends collaboration |
| First-version delegation | Owner delegates; direct delegation by other members is excluded |
| `me` and `agent` | `me` is the Human Principal; `agent` is the current Agent |
| Agent queue | `list_agent_issues`; Human `list_my_issues` keeps its existing meaning |
| Pause and Revoke | Clear open Agent assignments, preserve history; reauthorization does not restore assignments |
| Delete and Owner departure | Product deletion with an irreversible tombstone; no transfer of old authorization |
| Legacy Grant recovery | Revoke old credentials; require explicit new Consent and a newly bound Grant |
| Assignment | Current execution responsibility, not an implicit Runtime start or Delegation |
| Current attribution | Integrated Issue operations first; other aggregates retain Human attribution |

The original Issue proposes Admin-created Identities. This proposal uses Owner self-service creation during OAuth Consent to reduce setup steps while retaining Admin viewing, pause, revocation, and deletion. Maintainers need to explicitly accept this deviation from the Issue.

## Long-term goals

### Agents in the team

Orbit already organizes collaboration around Workspaces, Teams, Issues, shared documents, notifications, and Realtime. Agent integration extends those relationships. Humans and agents use the same work items and resource visibility rules, rather than maintaining a separate agent task list to explain the output.

The product judgment is that teams already using external agents need to distinguish executor from authorizer, assign work clearly, retain human acceptance, and revoke access. Issue 215 describes that problem. There is no real-team usage evidence establishing that every Orbit user needs agents.

Agent functionality should be optional. Teams without an agent keep the existing free, realtime, keyboard-first workflow. It introduces no seats, pricing tiers, extra human roles, or product telemetry sent outside the instance.

The collaborator goal has observable outcomes: a shared Issue identifies the agent doing the work and the human accountable for the result; revoked access prevents further Orbit mutations; failure or a request for input is visible so a human can take over. Trustworthy assignment, authorization, and execution state matter more than simply adding an agent avatar to the member list.

### Orbit and external execution environments

Orbit owns work items, authorization, resource access, responsibility, collaboration records, and visible controls. External environments run models and execution loops, enforce tool sandboxes, and isolate local files, Shell access, browser state, and credentials.

MCP currently connects agents to Orbit data and operations. It does not by itself provide a complete protocol for Orbit to dispatch tasks, wake offline processes, or manage runs. Automatic execution needs a separate delivery protocol and Session context.

Execution environments should remain replaceable rather than requiring one particular harness. Design a Runtime Adapter when a real execution integration needs it, not an unused framework inside the Identity PR.

## Long-term domain model

### Separate objects for separate responsibilities

```text
Agent Identity
    +-- Workspace Registration
    +-- Runtime Binding
    +-- Issue Assignment
    +-- Delegation
            +-- Agent Session
                    +-- Agent Activities
```

These are conceptual relationships. Cardinality and final tables belong to the corresponding implementation stages.

| Object | Question it answers | Design requirement |
| --- | --- | --- |
| Agent Identity | Who acts? | Stable name, avatar, identity, and historical references independent of credentials |
| Workspace Registration | Why may the team use it? | Owner consent, approval record, discovery and delegation scope, revocation |
| Runtime Binding | Where does it run, and who controls it? | Execution environment and trusted subject; distinguish authorization connection from process availability |
| Issue Assignment | Who currently does the work? | Human or Agent executor with continuing Human Owner responsibility |
| Delegation | Who asked the agent to do what? | Explicit request, initiator, input, and authorization; no inferred consent from Issue contents |
| Agent Session | How far has one run progressed? | Run state and result; an Issue may have multiple Sessions |
| Agent Activities | What happened during execution? | Progress, tool actions, input requests, results, and errors; immutable key inputs and outputs |

MCP Grant remains a separate authorization record, not a substitute for these objects. Human subscriptions and notifications are not execution requests either.

### Sharing scope and execution location are independent

| Sharing scope | Member-controlled local environment | Remote or hosted environment |
| --- | --- | --- |
| Personal Agent | Owner's own local agent | Owner's own remote agent |
| Workspace Agent | Local agent explicitly shared by its Owner | Member-shared remote agent or organization-hosted agent |

Personal does not mean Local, and Workspace does not mean Hosted. A member's remote Runtime remains constrained by that member's permissions. Running in the cloud does not establish organization-level trust.

An approved Registration preserves Identity and contribution history. After sharing is revoked, the Owner may continue personal use if Personal authorization remains valid. Grant, Registration, Runtime availability, and Session have separate states rather than implicitly overriding one another.

The current MVP creates an irreversible Identity tombstone when the Owner leaves. A future Registration or new Runtime cannot revive it. Organization-owned Workspace Identities require a separate authorization subject, lifecycle, and migration design rather than bypassing deletion semantics.

### Delegation control and human responsibility

The Agent Owner controls direct delegation to a Personal Agent. Seeing its contribution on shared resources does not allow another member to invoke it, wake it with a mention, or submit execution requests. Admins may block access and govern the workspace; they cannot supply the Owner's consent to use that Runtime.

Owner consent is necessary for future sharing, but not sufficient. Sharing also requires Workspace approval, a defined invocation scope, valid authorization, and resource permissions. Expanded resource scope, new capabilities, or a changed key Runtime controller require renewed confirmation and approval. Owners may stop sharing at any time; Admins cannot force continued use.

Issue Owner remains accountable for goals, blockers, and acceptance. Invoker, Registrant, Approver, and Runtime Operator do not automatically become Issue Owner. Changing executor preserves an existing Issue Owner.

Removing or replacing an Issue's Assignee is work-item editing, not control over that Personal Agent.

## Long-term Workspace Agent design

### Registration and approval

An Owner explicitly applies to share an agent. The application should associate Identity, Grant, Runtime Binding, controller, Team and resource scope, permitted invoking members or roles, and approved capabilities.

The first Workspace Agent stage uses Admin approval. Unapproved Registrations do not appear in ordinary member discovery, assignment, or invocation controls. Approval records retain applicant, approver, time, and exact scope. Approval cannot increase permissions.

Candidate Registration states are `pending_approval`, `rejected`, `active`, and `revoked`. These inform later specification; final names and recovery paths remain open.

Scope reduction, revocation, and stopping sharing take effect immediately. Runtime replacement, Team expansion, or capability changes cannot reuse approval whose conditions no longer apply.

Initial sharing may expose only policy-compliant discovery and manual assignment. Whether Assignment also creates Delegation requires a separate product decision and protocol; it is not enabled by default.

### Complete authorization chain

| Role | Fact to retain |
| --- | --- |
| Actor | Agent performing the action |
| Invoker | Person initiating this execution |
| Agent Owner | Subject owning the Identity and consenting to sharing |
| Registrant | Person submitting shared registration |
| Approver | Admin approving the particular scope |
| Runtime Operator | Person controlling a member-hosted execution environment |
| Grant Subject | Subject bound to the underlying credentials |
| Issue Owner | Person responsible for the work item's goals and result |

Roles may coincide, but their meanings remain separate. Audit needs executor, initiator, environment controller, approver, Grant, and the scope at the time. One Human Principal cannot represent every relationship.

### Member-controlled Runtime permissions

```text
Effective Permission
    = MCP Grant Scope
    ∩ Registration's approved scope
    ∩ Runtime Operator's current permissions
    ∩ Invoker's current permissions
    ∩ Resource Policy
```

Registration adds an authorization ceiling. An unavailable Registration disables team delegation; it does not replace the MCP Grant or current personal permissions.

Use this scenario to test the design. Member A can access only Team A; member B can access Team A and Team B. If B uses an agent controlled by A, Team B data must not enter A's Runtime. Conversely, if A has broader access and B can access only Team A, B must not use the agent to act on Team B.

Every tool call checks current Invoker, Runtime Operator, Registration, Grant, and resource permissions. Start-of-run snapshots explain history but do not retain later access.

Requests need server-verifiable execution context, not an Invoker asserted by the agent. A future Session credential should bind at least Identity, Registration version, Delegation, Invoker, Runtime Binding, Grant, and target scope. The exact issuance protocol remains to be designed.

Automation without a direct Human Invoker requires a separately defined Automation Principal. It cannot silently reuse a historical caller or default to an Admin identity.

### Organization-hosted Runtime

An organization-controlled Hosted Runtime isolated from personal credentials may use an organization-level authorization subject. Its permission ceiling should intersect organization Agent Grant, approved Registration scope, current Invoker permissions, and Resource Policy.

Organization Principal, credential issuance, Runtime trust evidence, and unattended automation are not finalized. The current Human-bound MCP Grant implementation does not already support organization agents.

## Long-term execution and visibility

### Assignment and Delegation boundary

Every Issue assignment entry point should use one Responsibility Module. It hides foreign-key combinations, Owner initialization, eligibility checks, and Activity, Notification, and Outbox orchestration.

If a future assignment mode may create Delegation, attach that policy at this boundary. Web, MCP, bulk editing, and board interactions should not independently construct execution requests, producing inconsistent start behavior for the same assignment change.

Delegation must retain requester, work item, Agent, input snapshot, approved scope, and authorization version. Inputs may contain Issue and document context, but effective permissions govern reading. Cancellation, acknowledgment, retry, and duplicate submission need explicit meanings, not merely reused comment text.

### Runtime delivery and Session

Automatic execution needs separate Runtime delivery. The protocol must define authentication, receipt acknowledgment, execution deduplication, offline behavior and timeouts, cancellation, and whether recovery permits continuation. Current MCP and Issue Outbox do not provide these responsibilities.

Session records a run, Issue State records work-item stage, and Runtime state records environment availability. A Session may complete while an Issue awaits Human Review. Runtime unavailability does not erase Session history.

Possible states are `pending`, `active`, `awaitingInput`, `complete`, `error`, and `stale`: awaiting receipt, executing, awaiting input, finished, failed, and prolonged lack of progress. This is a state-machine proposal, not a commitment to final states or timeouts.

Prefer deriving state from Activities, platform acknowledgments, and timeout rules. An agent reporting completion is not automatically human acceptance or Issue closure. Input requests, failures, and inactivity should notify appropriate humans; thresholds and escalation recipients need separate decisions.

### Agent Activities

Start with execution actions, progress, input requests, human follow-up input, results, and errors. Preserve important instructions, acknowledgments, and outputs as immutable snapshots rather than reconstructing them from comments edited later.

Progress does not require storing hidden model reasoning or a complete chain of thought. Work summaries, actions, and visible results support collaboration. Sensitive tool arguments, execution logs, file contents, and credentials need separate display and retention policies.

Members may see activities only for readable resources. Agent directories, Session summaries, errors, and notifications must also respect resource visibility rather than leaking private Issue names through aggregation.

### Revocation and takeover

Loss of Grant, Registration, Invoker, or Runtime Operator permissions must reject subsequent Orbit tool calls. Stopping sharing blocks new team execution requests. Running Sessions lose corresponding capabilities according to the final protocol.

Orbit can stop its own data access and request Runtime cancellation. Terminating an external Shell or process depends on Runtime protocol and isolation. Revocation cannot retrieve data already sent out; design and UI must state that limit.

Current Personal Identity deletion uses tombstones and open-assignment cleanup. Whether future Registration-only revocation retains unavailable assignments, and how Issue Owners are notified, requires its own lifecycle design. It does not change current Personal Agent cleanup rules.

## Short-term delivery design

### Stage goal

Complete the visible Personal Agent collaboration workflow so existing Identity, authorization, and Issue data capabilities work consistently across Web and MCP. The proposed delivery boundary for the current PR is this stage, not Workspace sharing, automatic execution, or Session support. The implementation document identifies the remaining gaps.

The review scenario is an Owner connecting their agent, having it claim a readable Issue, the team seeing the true Actor and Human Owner, then pausing or revoking access and confirming subsequent denial with history retained. This is an acceptance scenario, not a claim of production adoption.

### Personal Agent workflow

1. A member starts their agent in an external environment and connects to Orbit MCP.
2. OAuth Consent explicitly selects or creates a Personal Identity and shows Workspace, Client, and scopes.
3. The Owner gives instructions in their own conversation or assigns a readable Issue to their own agent in Orbit.
4. The running agent self-assigns with `assignee = "agent"`; an empty Issue Owner initializes to Agent Owner.
5. `list_agent_issues` returns the current Agent's assignments. `me` and `list_my_issues` retain Human Principal semantics.
6. The agent uses allowed Issue tools. On readable resources, the team sees its name, avatar, Activity, and Human Owner.
7. An authorized Owner or Admin pauses, revokes, or deletes it, revoking current authorization and clearing open Agent assignments. Valid Human Owner, closed-Issue Agent references, and attribution history remain. Resume requires reauthorization and does not restore assignments.

There is no direct third-party delegation. Even verbal Owner consent does not enable another member's invocation or sharing in the first version. Other members may ask the Owner to handle work; the Owner then instructs their agent.

Orbit currently proves that an MCP request holds the Owner's valid Grant. A token alone does not prove natural-language Owner approval for every action. The first version promises no per-instruction proof and does not infer consent from Issue contents written by other members.

### Work required for this stage

| Work | Design requirement | Acceptance condition |
| --- | --- | --- |
| Client Actor reading | Shared Issue response schemas preserve canonical Creator, Assignee, Owner, and Agent fields | REST reads, caches, Realtime patches, and refreshes retain Agent and Owner |
| Actor display | Detail, list, board, Activity, and Inbox show name, avatar, Agent marker, and tombstone state | Agent Assignee does not appear Unassigned; Human Principal is not substituted for Creator |
| Personal Agent picker | Owner may select their own eligible agent; other members cannot establish its assignment | Direct requests, bulk editing, and drag operations cannot bypass Owner-only rules |
| Human Owner | Separate responsibility display; existing Owner or authorized Admin can transfer it | Assignee changes preserve Owner; Agent cannot transfer Owner |
| Owner clearing | Controlled clearing under the same Policy only without an Agent Assignee | Input schemas, transactions, and activities have positive and negative tests |
| Assignment notification | Agent self-assignment notifies Agent Owner, not an inferred Issue Owner | Distinct Owners work; repeated assignment and idempotent replay do not duplicate notices |
| Member-removal preview | Show affected Agent deletion, connection revocation, and open-assignment counts | No unreadable Issue disclosure; confirmed cleanup matches the preview |
| Issue tool coverage | Inventory every Issue mutation; integrate Agent Context or explicitly reject | Duplicate, cycle, and new tools cannot fall into legacy Human write paths; Writer-off blocks all Agent Issue writes |
| Policy and Responsibility | Centralize assignment, Owner, lifecycle eligibility, and orchestration | Entry points share a testable interface without duplicated rules |
| Release and documentation | Check Worker requirements, migration support, gates, and safe rollback | Capability descriptions match code; event Worker is not described as an Agent Runtime |

Retain existing schema, exact Grant binding, lifecycle, permission intersections, Outbox, and idempotency. Repair workflow gaps and missing regressions rather than rebuilding these foundations.

### Target Responsibility Module interface

Concentrate responsibility changes behind a narrow, testable interface:

```text
assignIssue(context, issueId, assignee)
unassignIssue(context, issueId)
transferIssueOwner(context, issueId, ownerUserIdOrNull)
reconcileIssueResponsibilities(contextOrSystemCause, change)
```

The module owns Human and Agent foreign keys, read eligibility, Owner defaults, authorization, Activity, Audit, Notification, and Outbox. Entry points express intent rather than writing responsibility columns directly.

Owner clearing and transfer use the same authorization rule. System cleanup records cause and triggering facts rather than appearing as a departed member voluntarily unassigning work. Migrations and controlled fixtures may populate columns directly; product entry points must use the module.

Actor View reading and presentation use a shared model. Legacy Human fields are compatibility data; clients cannot infer Unassigned solely from `assigneeId = null`.

### Excluded from the first version

- Direct delegation to another person's Personal Agent, including a sharing UI after Owner consent.
- Workspace Registration, public Agent picker, and arbitrary member assignment of agents.
- Runtime Binding, wake-up, offline queues, background automatic claiming, and mention triggers.
- Delegation, Session, live progress, awaiting-input state, stale detection, and automatic escalation.
- Attribution across every MCP tool, complete audit consoles, productivity and cost analysis.
- Agent Reviewer, Subscriber, Human Owner, Team Membership, or independent Role.
- General mutation idempotency or exactly-once delivery promises.

An external agent may handle work its Owner actively gives it. The first version adds no Orbit background mechanism that scans other members' Issues and claims them automatically.

## Untrusted inputs

Issue titles, descriptions, comments, attachments, and shared documents may come from other members. They are task context, not authorization to expand scopes, change identity, start a private Runtime, or access Owner credentials.

The server checks real authorization. Runtimes must distinguish trusted Owner instructions from resource contents. Orbit resource Policy limits Orbit data access; it cannot replace a local tool sandbox. Excluding content-triggered execution reduces indirect delegation paths but does not establish that prompt injection is solved.

Future dispatch must accept only explicit, server-verified Delegation. Requests bind approved scope and identity version; a Runtime cannot manufacture an Invoker from an ordinary comment. Context retrieval uses the same permission intersection, especially to prevent sending a higher-privilege user's data into a lower-privilege member's environment.

## Staged progression

This is a proposed order requiring maintainer agreement and separate implementation specifications. It commits to no dates and does not require the current PR to deliver every stage.

| Stage | Delivery | Condition for progressing |
| --- | --- | --- |
| Complete Personal Agents | Web workflow, Owner, notifications, tool coverage, lifecycle preview | Agree #215 scope; complete workflow and critical security regressions pass |
| Workspace sharing | Owner consent, Registration, Admin approval, explicit discovery and assignment scope | Sharing governance and authorization chain tested without implicit execution |
| Explicit execution | Delegation, one real Runtime integration, unforgeable invocation context | Permission intersection, deduplication, cancellation, and offline failures verified |
| Execution collaboration | Session, visible Activities, input requests, results, human takeover | State machine, visibility, revocation, and retention policies agreed |
| Team operations | Complete Agent directory, audit, anomaly notifications, necessary automation | Real usage feedback; organization authorization and unattended execution model defined |

Workspace sharing remains a core long-term goal. Completing Personal workflows first validates collaboration with fewer authorization roles, then evolves the same Identity, Issue Responsibility, and attribution model.

## Decisions for upstream review

| Decision | Current situation | Proposed treatment |
| --- | --- | --- |
| Self-service or Admin-created Identity | Code uses Owner Consent; original Issue proposes Admin creation | Explain setup simplicity and Admin revocation safeguards; obtain maintainer agreement |
| Two Active Identity limit | Code contains the limit; contribution policy excludes usage limits | Not a permanent principle; remove before merge or obtain an explicit policy decision |
| Issue-only attribution | First stage integrates one aggregate; other tools retain Human paths | Publish a clear capability matrix; confirm the acceptable first step |
| Fixed Client binding | Identity permanently binds to its first MCP Client | Preserve exact binding now; separately design Runtime switching, not arbitrary takeover |
| Complete Web workflow in this PR | Reader, assignment, and Owner UI are incomplete | Prefer completion as a #215 condition; if split, explicitly identify undelivered follow-up work |
| Long-term Workspace and execution scope | This proposal expands team sharing and execution; full roadmap is not approved | Review concepts and security first, then separate Registration, Delegation, and Session proposals |

Do not simplify implementation by adding an Identity Role, borrowing Admin privileges, or transferring Owner Grants automatically. A new authorization subject requires its own design and tests.

## Short-term acceptance and delivery gates

Add tests that fail when current gaps recur, especially schema stripping of canonical Actors, confusing Agent with Unassigned, distinct Agent Owner and Issue Owner notifications, Owner clearing, and another member directly assigning a Personal Agent.

| Layer | Required evidence |
| --- | --- |
| Shared Policy | Independent denial by scopes, current Owner permissions, and resource Policy; no Personal delegation privilege for Admins |
| Real database | Creator XOR, Assignee XOR, required Human Owner for Agent, same Workspace, one Active Grant |
| Core | Atomic creation, assignment, transfer, clearing, cross-Team moves, downgrade, revocation, and real two-connection races |
| MCP | `me` and `agent`, both queues, full current tool coverage, exact Grant binding, Writer-off failure closed |
| Web | Owner-only Agent picker, Creator and Owner display, removal preview, cache and Realtime consistency |
| Delivery | Redis retry, duplicate-event deduplication, no rollback by late versions, no Grant IDs in public events |
| Migration | New database, official continuous-prefix upgrade, historical backfill, repeated release and catch-up, drift |

Record candidate-SHA evidence for `bun run verify`, ordinary E2E, `bun run test:e2e:agent-release`, database release and drift, and Web and documentation builds. Use isolated lanes and task-specific environments without damaging shared services or credentials.

Distinguish rerun results from earlier evidence and identify each commit. Changes affecting Worker or migration paths require relevant new validation, not only old results. Existing skip reasons remain auditable; weakened assertions or new skips are not a completion strategy.

The four default-off gates and compatible readers allow staged enablement. Ensure all readers understand Agents before enabling Consent and writing. Outbox Worker and Web use the same PostgreSQL and Redis; production operational responsibility must be settled before launch.

Local acceptance supports PR review, not production release. Closing #215 depends on upstream-accepted scope and workflow coverage. Deployment additionally requires target-environment migration, OAuth, S3, public endpoint, Worker, and monitoring validation.

## Questions for later specifications

Prioritize how shared invocation obtains real Owner consent, how changes in Runtime controller trigger renewed approval, and how organization-hosted identities are authorized. The execution protocol must settle receipt, cancellation, Session states, offline thresholds, retries, and recovery.

Activities need concrete visibility, log retention, input and result snapshots, anomaly notifications, and human takeover rules. Inactivity thresholds, escalation recipients, and automation authorization remain undecided.

These open questions retain Workspace Agents as a long-term goal without presenting them as implemented in the current PR.
