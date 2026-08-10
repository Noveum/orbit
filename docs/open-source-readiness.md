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

### Merged on `main`

- [#280](https://github.com/Noveum/orbit/pull/280) defined the public Preview
  boundary, retained Noveum AI sponsorship and Apache-2.0 attribution, disabled
  Slack across supported product paths, kept GitHub available with corrected
  permissions documentation, and removed tenant-specific Yodu operations.
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

GitHub records show successful hosted CI and Greptile review on the merged
heads. These pull requests reduce the known gaps, but they do not make the
repository a supported production release.

### Active pull requests

- [#283](https://github.com/Noveum/orbit/pull/283), DEP-001, adds a tested
  standalone Node start path and copied-artifact smoke test. Status: in progress,
  not merge-ready. The public head is behind `main`, its hosted end-to-end job
  failed, and final review found standalone prerequisite and troubleshooting
  documentation corrections that must land before exact-head verification.
- [#288](https://github.com/Noveum/orbit/pull/288), part of PORT-001, stops the
  destructive demo seed before database-client initialization unless the target
  is the exact development Compose database or a target-bound confirmation is
  supplied. Status: in progress, not merge-ready. Its hosted end-to-end job
  failed because CI did not supply the newly required target confirmation. The
  updated public head contains current `main` and a reviewed fix scoped to the
  end-to-end job. Full isolated local verification is green; the updated head
  must still pass hosted CI and Greptile review.
- [#289](https://github.com/Noveum/orbit/pull/289), SEC-003, requires explicit
  MCP consent and PKCE, preserves OAuth continuation through passwordless login,
  and prevents issued token scopes from exceeding the active grant. Status: in
  progress. Its public head passed hosted CI and Greptile, but is behind `main`
  and must be refreshed and reverified before merge. Its current diff has an
  independent clean review.
- [#290](https://github.com/Noveum/orbit/pull/290) makes prepared statements an
  explicit strict application-pool setting, defaults to transaction-pooler-safe
  behavior, and rejects conflicting URL options. Status: in progress. Its public
  head is behind `main`. Its failed CodeQL gate is a confirmed high-severity
  quadratic-regex finding in connection URL normalization. A linear fix,
  adversarial regression coverage, and a complete exact-head rerun are required
  before merge.

### Merge gate for this work

- CodeRabbit is not an availability or merge gate for this project.
- A branch must contain current `main`, pass hosted CI on the exact head, finish
  exact-head Greptile review at 5/5 with no unresolved review threads, and pass
  an independent diff review before merge.
- Slack remains disabled and deferred. Requalification is tracked only as
  future work and is not part of the active merge sequence.

## Release rule

- P0 blocks a supported public Preview.
- P1 blocks a stable supported release unless a documented, time-limited
  exception is accepted by maintainers.
- P2 is follow-up work and does not belong in the first pull request unless it
  directly supports a P0 or P1 fix.
- Every behavioral fix needs a regression test. Every deployment claim needs a
  reproducible command or smoke test.

## P0 release blockers

- [ ] **RT-001: Durable realtime recovery.** **Status: open.** Persist deletes
  and other replayable events, publish through an outbox, detect gaps, and test
  Redis and reconnect failures. Current evidence is in the core backfill and
  delta bridge paths.
- [ ] **DB-001: Production migrations.** **Status: open.** Replace production
  `db:push` guidance with ordered migrations, a safe baseline for existing
  installs, drift checks, rollback guidance, and upgrade tests.
- [ ] **DB-002: Migration identity collisions.** **Status: open.** Reject reused
  migration indexes with different contents and compare the resulting catalog
  in CI.
- [ ] **DEP-001: Tested production start.** **Status: in progress in #283.**
  Provide a real start command for the standalone Next.js artifact and smoke-test
  the exact packaged output.
- [ ] **DEP-002: Portable realtime topology.** **Status: open.** Put the realtime
  service behind a same-origin proxy without relying on Vercel-only websocket
  behavior.
- [ ] **DEP-003: Application containers.** **Status: open.** Add reproducible
  production images and a complete Compose profile for web, realtime, Postgres,
  Redis, and object storage.
- [ ] **DEP-004: First-login validation.** **Status: open.** Refuse a production
  start unless at least one complete authentication path is configured and
  tested.
- [ ] **PORT-001: Neutral seed and import tooling.** **Status: partial through
  #281 and #287, with #288 active.** Neutral demo data and unsafe importer
  quarantine are complete. Remaining work includes tenant-specific test
  fixtures, a branded settings placeholder, and supported argument-driven,
  dry-run-first replacement importers. Legitimate sponsorship and project
  contact references remain by design.
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
- [ ] **SEC-003: Immutable MCP grants.** **Status: in progress in #289.** Bind
  tokens to one grant and workspace, and revoke them when consent or scope
  changes.
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
  repository checks, build, and end-to-end suite. Container, migration,
  packaged-start, and realtime smoke coverage is not all complete.

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
- [ ] **SEC-012: Slack metadata authorization.** **Status: deferred with
  INT-002.** When Slack work resumes, require server-side integration management
  permission and denial tests.
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
- [ ] **REL-001: Operational readiness.** **Status: open.** Split liveness from
  readiness, require configured capabilities, and document and schedule
  retention work.
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
  enforcement. Remove stale CodeRabbit requirements from `CLAUDE.md` and
  `CONTRIBUTING.md` so documented review gates match the active policy.

## Deferred P2 work

- [ ] **INT-002: Slack requalification.** **Status: deferred.** Slack stays
  disabled and absent from supported claims until OAuth, events, permissions,
  delivery, and end-to-end behavior are repaired in a separate project.
- [ ] **REPO-002: Large module cleanup.** **Status: deferred.** Split oversized
  services and normalize test-support placement only after behavioral safety
  nets exist.

## Recommended pull request order

1. Preview boundary, Slack disablement, GitHub documentation, and tenant-specific
   operational cleanup.
2. Neutral demo seed, import configuration, screenshots, and privacy cleanup.
3. Migration safety, production start, application images, and Compose.
4. Durable realtime recovery and idempotent GitHub delivery processing.
5. Authentication, MCP, upload, invitation, avatar, and request-boundary
   security batches.
6. Dependency, CI, release, observability, backup, restore, and operator docs.

## Verification required for each pull request

- Focused failing-first and regression tests for the changed behavior.
- `bun run verify` with local Postgres, Redis, and object storage available.
- `bun run build` for changes that affect the web application or packaging.
- `git diff --check`, comment policy, source-byte policy, and an em dash scan.
- A clean independent review of the exact diff before merge.
- Hosted CI on the exact commit that will merge.

## Audit limits

The repository audit covered source, packages, schema, migrations, scripts,
tests, documentation, workflows, Docker configuration, tracked media, dependency
advisories, and Git history secret patterns. It did not inspect production cloud
accounts, bucket policy, database roles, Redis ACLs, DNS, TLS, live provider
registrations, or legal ownership records. No likely live credential was found
in tracked files or history, but external secret rotation and media ownership
still require human confirmation.
