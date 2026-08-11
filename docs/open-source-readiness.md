# Open source readiness tracker

Orbit is Apache-2.0 software sponsored by [Noveum AI](https://noveum.ai).
The license permits independent use, modification, distribution, and commercial
operation. The current self-hosting status is **Preview**, not a supported
production release.

This is the one repository tracker for the initial open-source work. It records
verified gaps and the outcome required to close each one. Implementation should
be split into focused pull requests instead of adding a separate policy system
to the codebase.

## Status snapshot: 2026-08-11

### Merged readiness implementation pull requests

- [#280](https://github.com/Noveum/orbit/pull/280) defined the public Preview
  boundary, retained Noveum AI sponsorship and Apache-2.0 attribution, disabled
  Slack across supported product paths, kept GitHub available with corrected
  permissions documentation, and removed tenant-specific operations.
- [#281](https://github.com/Noveum/orbit/pull/281) replaced the built-in demo
  workspace, people, identifiers, domains, time zones, documentation examples,
  and end-to-end fixtures with neutral fictional data.
- [#282](https://github.com/Noveum/orbit/pull/282) replaced the documentation
  screenshots, removed the private avatar importer and its Slack object URLs,
  and removed a tracked private demo upload artifact.
- [#285](https://github.com/Noveum/orbit/pull/285) completed SEC-004. GitHub
  callback binding now rechecks current administration rights before provider
  exchange and inside the serialized binding transaction, rejects deleting
  workspaces, and distinguishes an unavailable workspace from a claimed
  installation.
- [#287](https://github.com/Noveum/orbit/pull/287) quarantined the unsafe
  one-off database import path by removing destructive and tenant-specific
  import commands while retaining the neutral mapping boundary needed for a
  future supported importer.
- [#288](https://github.com/Noveum/orbit/pull/288) guarded the destructive demo
  seed before database-client initialization, limited the confirmation-free
  exemption to the exact development Compose target, and bound every other
  confirmation to a credential-safe target identity. It merged as `9779141`
  after all exact-head checks and required reviews passed.
- [#283](https://github.com/Noveum/orbit/pull/283) completed DEP-001 with a
  portable standalone Node start path, copied-artifact smoke coverage, and
  aligned self-hosting and troubleshooting guidance. It merged as `811b0c5d`
  after all exact-head checks and required reviews passed.
- [#290](https://github.com/Noveum/orbit/pull/290) made prepared statements an
  explicit strict application-pool setting, defaulted to
  transaction-pooler-safe behavior, rejected conflicting URL options with
  linear-time parsing, and added adversarial regression coverage. It merged as
  `e43d229f` after full local and hosted exact-head verification passed with no
  unresolved review threads.
- [#294](https://github.com/Noveum/orbit/pull/294) completed DEP-004 by
  rejecting production builds and standalone starts without a usable
  first-login path, accepting password authentication, complete Google or
  GitHub credentials, or Resend with an explicit non-local sender.
  Copied-artifact smoke coverage verifies rejected and successful startup, and
  operator documentation records first-user bootstrap limits. It merged as
  `64f7972` after full local and hosted exact-head verification passed with no
  unresolved actionable review finding.
- [#289](https://github.com/Noveum/orbit/pull/289) completed SEC-003 by
  requiring explicit consent and RFC 7636 PKCE, binding access and refresh
  credentials to immutable workspace grants, enforcing active scopes and
  revocation, and consuming refresh credentials once. It merged as `4359717f`
  after full local and hosted exact-head verification, CodeQL, and independent
  security review passed with every review thread resolved.

GitHub records show successful hosted CI and completion of required reviews on
the merged heads. These pull requests reduce the known gaps, but they do not
make the repository a supported production release.

The checklist currently has 4 of 19 P0 items complete, with 15 P0 items and all
23 P1 items remaining. The 5 P2 items are explicitly deferred or tracked as
follow-up work.

### Merge gate for this work

- For this readiness sequence, maintainers approved a documented independent
  review of the exact diff when the optional review service was unavailable.
  Hosted CI and review-thread clearance remain required.
- A branch must contain current `main`, pass hosted CI on the exact head, finish
  required exact-head review at its highest confidence level with no unresolved
  review threads, and pass an independent diff review before merge.
- Slack remains disabled and deferred. Requalification is tracked only as
  future work and is not part of the active merge sequence.

### Known verification warnings

- `biome.json` references schema version 2.5.5 while the installed Biome CLI is
  version 2.5.7.
- `packages/db/tests/check-source-bytes.test.ts:19` reports the Biome
  `noTemplateCurlyInString` lint warning.

## Release rule

- P0 blocks a supported public Preview.
- P1 blocks a stable supported release unless a documented, time-limited
  exception is accepted by maintainers.
- P2 is follow-up work and does not block Preview or the first stable release
  unless it directly supports a P0 or P1 fix.
- Every behavioral fix needs a regression test. Every deployment claim needs a
  reproducible command or smoke test.

## P0 release blockers

- [ ] **RT-001: Durable realtime recovery.** **Status: open.** Persist deletes
  and other replayable events, publish through an outbox, detect gaps, and test
  Redis and reconnect failures. Current evidence is in the core backfill and
  delta bridge paths. Until this lands, `docs/architecture.md` must describe
  reconnect replay as best effort and identify hard-delete and publish-gap
  limits.
- [ ] **DB-001: Production migrations.** **Status: partial.** Ordered migrations
  and a from-scratch migration and drift check exist in CI. Replace production
  `db:push` guidance, add a safe baseline for existing installs, rollback
  guidance, and upgrade tests.
- [ ] **DB-002: Migration identity collisions.** **Status: open.** Reject reused
  migration indexes with different contents, compare the resulting catalog in
  CI, define the rebase policy, and decide whether databases that applied the
  abandoned `0003_productive_quicksilver` migration are supported. Test every
  supported upgrade path instead of treating prevention as historical repair.
- [x] **DEP-001: Tested production start.** **Status: complete in #283.** The
  standalone Next.js artifact has a portable Node start command and a
  copied-artifact smoke test.
- [ ] **DEP-002: Portable realtime topology.** **Status: open.** Put the realtime
  service behind a same-origin proxy without relying on Vercel-only websocket
  behavior.
- [ ] **DEP-003: Application containers.** **Status: open.** Add reproducible
  production images and a complete Compose profile for web, realtime, Postgres,
  Redis, and object storage.
- [x] **DEP-004: First-login validation.** **Status: complete in #294.**
  Production builds and standalone starts now require at least one complete
  first-login path, with regression and copied-artifact coverage for rejected
  and valid configurations.
- [ ] **PORT-001: Neutral seed and import tooling.** **Status: partial through
  #281, #287, and #288.** Neutral demo data, unsafe importer quarantine, and
  destructive seed protection are complete. Remaining work includes
  tenant-specific unit and integration fixtures and branded product-form
  placeholders. A future general-purpose importer is optional product work, not
  a release blocker. Legitimate sponsorship and project contact references
  remain by design.
- [ ] **PRIV-001: Personal and branded artifacts.** **Status: partial through
  #282.** Current screenshots and private working artifacts were replaced or
  removed. Historical blobs, media ownership, and external ownership records
  still require human review.
- [ ] **SEC-001: Upload abuse controls.** **Status: open.** Add durable tenant and
  user quotas, concurrency and rate limits, abandoned-upload cleanup,
  reconciliation, and failure tests.
- [ ] **SEC-002: Invitation abuse controls.** **Status: open.** Add durable
  sender, tenant, IP, and recipient limits with resend cooldowns and provider-safe
  retries.
- [x] **SEC-003: Immutable MCP grants.** **Status: complete in #289.** Access
  and refresh credentials are bound to one workspace grant, active scope and
  revocation are enforced, and refresh credentials are consumed once.
- [x] **SEC-004: Integration callback authorization.** **Status: complete in
  #285.** Current administration permission is rechecked before provider exchange
  and again inside the serialized binding transaction.
- [ ] **TEN-001: Tenant-scoped GitHub deliveries.** **Status: partial.** Complete
  attribution for every delivery, hide unattributed rows, and prove isolation
  with two-tenant tests.
- [ ] **SEC-005: Safe avatar ingestion.** **Status: open.** Bound outbound
  fetches, prevent SSRF, decode and transcode images, fix the served content type,
  and isolate storage.
- [ ] **SEC-006: Dependency policy.** **Status: open.** Upgrade or override
  affected dependencies, verify reachability again, and make the agreed audit
  threshold a CI gate.
- [ ] **SEC-018: One tenant lifecycle.** **Status: open.** Disable Better Auth
  organization mutations that bypass Orbit policy and route every organization
  change through the canonical storage, session, and realtime-aware service.
- [ ] **INT-001: Least-privilege GitHub App.** **Status: partial.** The supported
  permission documentation is corrected, but one tested permission and event
  manifest with generated or validated setup documentation remains.
- [ ] **CI-001: Production-shaped CI.** **Status: partial.** Existing CI runs the
  repository checks, a from-scratch migration and drift check, build, copied
  standalone smoke, and the end-to-end suite. Application-container and
  portable-realtime smoke coverage remain.

## P1 release requirements

- [ ] **DEP-005: Safe development Compose.** **Status: open.** Bind services to
  loopback, separate Compose configuration from the application `.env`, pin
  images, and label all included credentials as development-only.
- [ ] **DEP-006: Portable email.** **Status: open.** Retain Resend and add a
  tested SMTP transport with local mail capture for development.
- [ ] **DEP-007: Operator-selected region.** **Status: open.** Remove the
  hard-coded Vercel compute region and document data-affinity choices.
- [ ] **SEC-007: Markdown privacy.** **Status: open.** Narrow permitted classes
  and define a safe policy for remote images.
- [ ] **SEC-008: Response headers.** **Status: open.** Add and test CSP, frame,
  MIME, referrer, permissions, and production HSTS policy with a staged rollout.
- [ ] **SEC-009: Production environment validation.** **Status: open.** Reject
  weak or placeholder secrets, localhost defaults, non-HTTPS public URLs, and
  inconsistent origins.
- [ ] **SEC-010: Input size limits.** **Status: open.** Apply shared byte limits
  to JSON, webhooks, uploads, and websocket messages before parsing or buffering
  them.
- [ ] **SEC-011: Email token retention.** **Status: open.** Avoid retaining raw
  magic, reset, and invite tokens; define tenant ownership, deletion, and
  retention.
- [ ] **SEC-013: Account linking and recovery.** **Status: open.** Default to
  matching identities, require step-up for sensitive changes, and prevent
  unlinking every credential.
- [ ] **SEC-014: Minimal public health.** **Status: open.** Expose only liveness
  publicly and keep topology and dependency diagnostics behind an authenticated
  boundary.
- [ ] **SEC-015: Credential encryption.** **Status: open.** Encrypt OAuth tokens,
  integration credentials, and webhook secrets with versioned keys and rotation
  support.
- [ ] **SEC-016: Unsafe request policy.** **Status: open.** Add one Origin and
  fetch-metadata gate for cookie-authenticated writes and a shared distributed
  rate-limit service.
- [ ] **SEC-017: Least-privilege database roles.** **Status: open.** Separate
  runtime and migration authority and require encrypted service connections.
- [ ] **SEC-019: Idempotent GitHub retries.** **Status: open.** Claim deliveries
  atomically and make database, realtime, and notification effects durable and
  idempotent.
- [ ] **EXP-001: Reliable PDF export.** **Status: open.** Normalize attachment
  URLs, bound remote images, await generation and download, and verify the result
  end to end.
- [ ] **PRIV-002: Web Vitals minimization.** **Status: open.** Add operator
  controls and sampling, reduce recorded attribution, document retention, and
  test deletion and abuse limits.
- [ ] **REL-001: Operational readiness.** **Status: open.** Require configured
  capabilities and document and schedule retention work.
- [ ] **MCP-001: Accurate tool annotations.** **Status: open.** Mark destructive,
  read-only, idempotent, and open-world behavior correctly for every MCP tool.
- [ ] **CI-002: Immutable CI inputs.** **Status: open.** Pin actions and container
  images, declare least-privilege workflow permissions, and avoid persisted
  credentials.
- [ ] **REL-002: Repeatable releases.** **Status: open.** Define versioning and
  compatibility, publish changelogs, signed artifacts, images, SBOMs, provenance,
  and upgrade notes.
- [ ] **CFG-001: One configuration contract.** **Status: open; #290 handles one
  database setting.** Consolidate capability-aware validation and add a `doctor`
  command that reports missing requirements.
- [ ] **DOC-001: Tested operator documentation.** **Status: partial.** Existing
  architecture, configuration, and self-hosting documents need verified
  quickstarts plus backup, restore, upgrade, and incident runbooks.
- [ ] **REPO-001: Consistent contributor policy.** **Status: open.** Align agent
  instructions, generated files, test placement, Biome exceptions, and CI
  enforcement. Remove stale review requirements from repository instruction
  files and contributor guidance so documented gates match the active policy.

## Deferred P2 work

- [ ] **SEC-012: Slack metadata authorization.** **Status: deferred with
  INT-002.** It is not a release blocker while Slack is disabled. When Slack
  work resumes, require server-side integration management permission and
  denial tests.
- [ ] **INT-002: Slack requalification.** **Status: deferred.** Slack stays
  disabled and absent from supported claims until OAuth, events, permissions,
  delivery, and end-to-end behavior are repaired in a separate project.
- [ ] **MCP-002: OIDC signing metadata alignment.** **Status: upstream
  follow-up.** Better Auth metadata advertises RS256 while its current ephemeral
  ID token is emitted with HS256. Track the upstream correction and add
  interoperability coverage before relying on that metadata.
- [ ] **MCP-003: Grant issuance race cleanup.** **Status: low-severity
  follow-up.** Concurrent allow and deny decisions can let approval create a
  valid grant while the losing denial path deletes no consent row but still
  reports `access_denied`. Serialize the decisions or require the denial to
  consume the pending consent row, then add a two-request regression. This does
  not create cross-workspace access.
- [ ] **REPO-002: Large module cleanup.** **Status: deferred.** Split oversized
  services and normalize test-support placement only after behavioral safety
  nets exist.

## Verification required for each pull request

- Focused failing-first and regression tests for the changed behavior.
- `bun run verify` with local Postgres, Redis, and object storage available.
- `bun run build` for changes that affect the web application or packaging.
- `git diff --check`, comment policy, source-byte policy, and an em dash scan.
- A clean independent review of the exact diff before merge.
- Hosted CI on the exact commit that will merge.

## Audit limits

The full repository baseline audit was pinned to `f1bfdc3`, followed by a
targeted delta review through `9f961a1`. Later readiness pull requests were
reviewed and verified individually through current `main` at `4359717f` before
this documentation-only tracker update; this is not a claim that the full
baseline audit was rerun after every intervening commit. The audit covered
source, packages, schema, migrations, scripts, tests,
documentation, workflows, Docker configuration, tracked media, dependency
advisories, and Git history secret patterns. It did not inspect production cloud
accounts, bucket policy, database roles, Redis ACLs, DNS, TLS, live provider
registrations, or legal ownership records. No likely live credential was found
in tracked files or history, but external secret rotation and media ownership
still require human confirmation.
