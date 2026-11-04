# Issue transaction events and reliable realtime publishing

Status: design proposal only. No implementation, migration, feature gate or deployment is included. This working proposal belongs outside public product documentation. It follows the Actor readers, compatibility runtime, bound Agent consent and controlled Issue writes in #564, #562, #565 and #566, retaining the earlier #523, #524 and #525 history. It does not block those stages. Request idempotency remains separate under #407.

## Delivery contract

Persist covered Issue actions in the same PostgreSQL transaction as their business changes once the producer gate is enabled. With that gate off, retain existing delivery behavior. With it on, return the original successful business result when only post-commit publishing fails. Authorization, validation and transaction failures still fail. Slack and email retain the existing Provider Outbox. Realtime retries never repeat business writes or notification planning.

Initial coverage is create, update, sub-Issues, bulk update, move, cycle assignment, archive, unarchive, deletion, relations and duplicate marking through their shared Core transactions. Include complete Issue, relation, subscription, source-departure, destination and notification conversation/counter actions. Comments, attachments, import, GitHub, sprint and independent subscription producers remain later work. Preserve Actor, Owner, originClientId and Sync ID exactly.

Delivery is at least once up to Redis acceptance during a bounded delivery lifetime. Duplicates and disorder are possible. Receipt by every browser and unbounded retention are not promised. Missing Redis configuration is a retryable delivery failure, never successful delivery. No request idempotency keys, cached business responses or timed business-execution reclaim are introduced.

## Sequential implementation and release

Use separate pull requests and sequential main releases. Each release must independently pass verification, append migrations after the then-current immutable ledger, and carry an exact deployable artifact. Do not review one cumulative implementation and run all migrations from its final checkout as a substitute for preparation deployment.

1. Consumer preparation: ship current-authorization checks, duplicate/disorder protection, move departure/arrival handling and safe invalidation. Retain the existing v1 global since behavior. Deploy and verify all consumers, including older browser bundles and long-lived hubs.
2. Storage and drain preparation: append the outbox migration and ship producer-disabled storage, bounded draining, authenticated cron, Docker scheduler coverage, observability and pruning. Verify every deployment target runs this runtime before any producer can write a durable event.
3. Producer integration: integrate covered transactions behind ORBIT_ISSUE_OUTBOX, default false. This independent gate covers Human REST writes and Human MCP writes as well as Agent Issue writes. ORBIT_AGENT_MCP and ORBIT_AGENT_ISSUE_WRITE never substitute for the Human producer gate. With the producer gate off, existing direct publishing remains unchanged. With it on, each covered action uses exactly one transactional staging path and never also publishes directly.
4. Activation: record exact deployed builds, migration ledger/drift checks, scheduler health, old-hub inventory and removal, rollback floor and smoke evidence. Enable producers only after every prerequisite is proven. Retain an immediate producer kill switch.

Rollback disables new producers first, keeps the expanded schema and compatible consumers, and continues draining already committed rows. Do not downgrade below the storage/drain preparation runtime while backlog exists. Agent credential and business-row rollback floors from #565/#566 still apply. Unknown event versions become blocked rather than being reinterpreted.

## Wire protocol and v1 compatibility

Global v1 since response semantics remain unchanged. Never let a durable action bypass the existing global filter for a v1 connection. Optional metadata alone does not negotiate a new protocol. A later protocol revision requires explicit version/capability negotiation, independent review and mixed-version tests before implementation.

For v1, reconcile delayed actions against current authoritative data and use existing reference invalidation/resync behavior when an action is below the connection watermark or cannot safely be projected. If current v1 behavior cannot recover an affected surface without changing its contract, leave that producer disabled until a separately reviewed recovery path exists. Do not claim replay guarantees for such a surface.

Protect older browser bundles at the hub: check current tenant, membership, Team and resource access before queuing and again before flushing sensitive delayed payloads. Preserve source tombstones for moves without exposing destination content to former readers. Deduplicate by stable event identity and ordinal, so departure and arrival sharing an Issue Sync ID do not erase each other. Per-object versions and tombstones prevent regressions or resurrection. Notification counters use their own version, not the parent Issue version. Revoking an Agent grant after commit does not replace its historical Actor with a Human.

## Transaction storage, bounded lifetime and draining

Use a narrow dedicated realtime outbox table, separate from Provider delivery. Store organization, stable event ID/ordinal, schema version, minimal canonical payload, original context, createdAt, expiresAt, state, attempts, availableAt, claim token, lease expiry and bounded error reason. Stage the complete action sidecar once at the actual top-level transaction boundary. A no-op stages nothing. A rollback leaves no outbox rows.

Claim through short transactions with SKIP LOCKED, a stable per-row fencing token and leases. Finalization or release requires the exact current token. Publish outside the claim transaction under explicit connection and operation deadlines. Use bounded batches, concurrency, total runtime and tenant fairness. Start with at most 100 claims per run, concurrency 4, a 5-second run budget and a 30-second lease; measure before changing them. Do not claim more work after the deadline. An expired claimant cannot modify the next claimant record, though consumers must tolerate an already published duplicate.

Set a finite delivery TTL, initially 24 hours from commit, and a maximum retry count, initially 20. Backoff uses jitter and a bounded cap. Expired or exhausted pending/retry rows move to terminal expired/dead state with an actionable resync reason. Never retain an indefinitely retryable payload. Unknown versions, unsafe projection and malformed payloads enter blocked state with a bounded reason and the same absolute expiry. Blocked rows count toward per-organization and global backlog limits, initially 10,000 and 100,000; reaching a limit fails staging inside the transaction while producers are enabled, alerts operators and requires disabling producers or draining before retry. Do not silently drop committed business side effects or fall back to an untracked direct publish.

A request schedules a small drain after the business response through Next after() or the hosting platform waitUntil integration. It must not await a drain in the MCP or REST response path. Failure to schedule or drain cannot turn a committed business success into a tool error. Serverless lifecycle termination is recovered by cron. A route test must hold the drain promise unresolved and still receive the successful response, then test rejected drain handling without an unhandled rejection.

## Scheduler and gate boundaries

Provide one authenticated drain endpoint and one shared bounded drain function. Schedule it every minute in Vercel and in the Docker Compose maintenance scheduler, plus every supported deployment catalog. Test deployed schedule definitions and scheduler dispatch, not only endpoint implementation. The standalone worker remains optional later work; Docker needs no separately invented daemon.

When ORBIT_ISSUE_OUTBOX is off, an authenticated cron request returns 200 with a no-op status if there is no backlog. It must never return 503 merely because any producer, Agent or Provider gate is disabled. If committed backlog exists, the compatible drain continues processing it with producers off. Invalid cron authentication still fails. Provider pause gates do not govern realtime drain, and Agent write gates only govern new Agent business writes.

Pruning processes expired, dead, blocked and published rows under bounded batches after their finite retention. It never deletes an actively leased row. Pending rows first become terminal at expiry and request resync through the reviewed recovery mechanism. Retain bounded delivery summaries and alert on oldest age, blocked/expired/dead counts, limit pressure and scheduler failures without exposing payloads, credentials or sensitive Issue content in logs.

## Required failure and compatibility tests

All implementation tests belong in package tests trees, import bun:test and use isolated database lanes. These tests are planned, not executed by this documentation change.

| Scenario | Required assertion |
| --- | --- |
| Transaction rollback and no-op | No committed outbox or Provider changes, no Redis request, no fabricated action |
| Exit after commit and Redis outage | Cron recovers the same event without repeating business writes; absent Redis never marks success |
| Publish accepted, finalize fails | Retry retains identity/ordinal and consumers tolerate duplicates |
| Multiple claimants and expired lease | Stable fencing prevents stale completion/release; bounded claims and tenant fairness |
| Every covered mutation | Complete transactional sidecar, Actor/Owner/origin preserved, exactly one staging path |
| Human producer gate off | Human REST and Human MCP retain their existing behavior and create no durable event |
| Gates and scheduler | Authenticated gate-off cron returns 200; backlog drains; invalid auth fails; Vercel, Docker and catalog schedules dispatch |
| TTL, retry exhaustion and limits | Finite termination for pending/retry/blocked rows; active leases survive pruning; limits fail staging visibly |
| v1 lower Sync ID and duplicates | Unchanged global since response/filter semantics; recovery never relies on bypass metadata |
| Move, delete and old browser bundle | No resurrection, destination loss, unauthorized payload or departure/arrival dedup collision |
| Notifications and current access | Counter versions never regress; revocation fences queued payloads; retries never rerun notification planning |
| Response-safe drain | Unresolved or rejected post-response drain never delays or changes successful REST/MCP business response |
| Upgrade and rollback | Sequential exact artifacts, immutable migration prefixes, preparation drains final backlog, producer-off rollback remains safe |

Before implementation begins, confirm the v1 recovery mechanism and its honest delivery limits. Before activation, the operator must verify preparation deployment, old-hub retirement, scheduler operation and the minimum rollback artifact. Remaining storage, retry and test details receive normal code review. This proposal is not approval to deploy or activate the feature.
