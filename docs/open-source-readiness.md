# Open source readiness tracker

Orbit is Apache-2.0 software sponsored by [Noveum AI](https://noveum.ai).
The license permits independent use, modification, distribution, and commercial
operation. The current self-hosting status is **Preview**, not a supported
production release.

This is the one repository tracker for the initial open-source work. It records
verified gaps and the outcome required to close each one. Implementation should
be split into focused pull requests instead of adding a separate policy system
to the codebase.

## Current pull request

- [x] Publish the Preview boundary in the README and self-hosting guide.
- [x] Keep Noveum AI sponsorship and Apache-2.0 attribution intact.
- [x] Disable Slack in the UI, OAuth, API, callback, webhook, notification, and
      GitHub side-effect paths until it is requalified.
- [x] Keep GitHub available and correct its documented permission set.
- [x] Remove the tenant-specific Yodu catchup and planning artifacts.
- [x] Pass focused tests, `bun run verify`, and the production build locally.
- [ ] Pass hosted CI on the pull request commit.

The completed items are implemented and locally verified on the current branch.

## Release rule

- P0 blocks a supported public Preview.
- P1 blocks a stable supported release unless a documented, time-limited
  exception is accepted by maintainers.
- P2 is follow-up work and does not belong in the first pull request unless it
  directly supports a P0 or P1 fix.
- Every behavioral fix needs a regression test. Every deployment claim needs a
  reproducible command or smoke test.

## P0 release blockers

- [ ] **RT-001: Durable realtime recovery.** Persist deletes and other replayable
  events, publish through an outbox, detect gaps, and test Redis and reconnect
  failures. Current evidence is in the core backfill and delta bridge paths.
- [ ] **DB-001: Production migrations.** Replace production `db:push` guidance
  with ordered migrations, a safe baseline for existing installs, drift checks,
  rollback guidance, and upgrade tests.
- [ ] **DB-002: Migration identity collisions.** Reject reused migration indexes
  with different contents and compare the resulting catalog in CI.
- [ ] **DEP-001: Tested production start.** Provide a real start command for the
  standalone Next.js artifact and smoke-test the exact packaged output.
- [ ] **DEP-002: Portable realtime topology.** Put the realtime service behind a
  same-origin proxy without relying on Vercel-only websocket behavior.
- [ ] **DEP-003: Application containers.** Add reproducible production images and
  a complete Compose profile for web, realtime, Postgres, Redis, and object
  storage.
- [ ] **DEP-004: First-login validation.** Refuse a production start unless at
  least one complete authentication path is configured and tested.
- [ ] **PORT-001: Neutral seed and import tooling.** Replace Noveum and Yodu
  identities, IDs, mappings, domains, and time zones with fictional demo data
  and argument-driven, dry-run-first importers.
- [ ] **PRIV-001: Personal and branded artifacts.** Remove private avatar
  manifests and Slack object URLs, replace screenshots and media where needed,
  and complete an ownership and history review.
- [ ] **SEC-001: Upload abuse controls.** Add durable tenant and user quotas,
  concurrency and rate limits, abandoned-upload cleanup, reconciliation, and
  failure tests.
- [ ] **SEC-002: Invitation abuse controls.** Add durable sender, tenant, IP, and
  recipient limits with resend cooldowns and provider-safe retries.
- [ ] **SEC-003: Immutable MCP grants.** Bind tokens to one grant and workspace,
  and revoke them when consent or scope changes.
- [ ] **SEC-004: Integration callback authorization.** Recheck the current admin
  permission before provider exchange and again inside the binding transaction.
- [ ] **TEN-001: Tenant-scoped GitHub deliveries.** Attribute every delivery to a
  workspace, hide unattributed rows, and prove isolation with two-tenant tests.
- [ ] **SEC-005: Safe avatar ingestion.** Bound outbound fetches, prevent SSRF,
  decode and transcode images, fix the served content type, and isolate storage.
- [ ] **SEC-006: Dependency policy.** Upgrade or override affected dependencies,
  verify reachability again, and make the agreed audit threshold a CI gate.
- [ ] **SEC-018: One tenant lifecycle.** Disable Better Auth organization
  mutations that bypass Orbit policy and route every organization change through
  the canonical storage, session, and realtime-aware service.
- [ ] **INT-001: Least-privilege GitHub App.** Keep one tested permission and
  event manifest and generate or validate setup documentation from it.
- [ ] **CI-001: Production-shaped CI.** Run every local verification gate and add
  container, migration, packaged-start, and realtime smoke tests.

## P1 release requirements

- [ ] **DEP-005: Safe development Compose.** Bind services to loopback, separate
  Compose configuration from the application `.env`, pin images, and label all
  included credentials as development-only.
- [ ] **DEP-006: Portable email.** Retain Resend and add a tested SMTP transport
  with local mail capture for development.
- [ ] **DEP-007: Operator-selected region.** Remove the hard-coded Vercel compute
  region and document data-affinity choices.
- [ ] **SEC-007: Markdown privacy.** Narrow permitted classes and define a safe
  policy for remote images.
- [ ] **SEC-008: Response headers.** Add and test CSP, frame, MIME, referrer,
  permissions, and production HSTS policy with a staged rollout.
- [ ] **SEC-009: Production environment validation.** Reject weak or placeholder
  secrets, localhost defaults, non-HTTPS public URLs, and inconsistent origins.
- [ ] **SEC-010: Input size limits.** Apply shared byte limits to JSON, webhooks,
  uploads, and websocket messages before parsing or buffering them.
- [ ] **SEC-011: Email token retention.** Avoid retaining raw magic, reset, and
  invite tokens; define tenant ownership, deletion, and retention.
- [ ] **SEC-012: Slack metadata authorization.** When Slack work resumes, require
  server-side integration management permission and denial tests.
- [ ] **SEC-013: Account linking and recovery.** Default to matching identities,
  require step-up for sensitive changes, and prevent unlinking every credential.
- [ ] **SEC-014: Minimal public health.** Expose only liveness publicly and keep
  topology and dependency diagnostics behind an authenticated boundary.
- [ ] **SEC-015: Credential encryption.** Encrypt OAuth tokens, integration
  credentials, and webhook secrets with versioned keys and rotation support.
- [ ] **SEC-016: Unsafe request policy.** Add one Origin and fetch-metadata gate
  for cookie-authenticated writes and a shared distributed rate-limit service.
- [ ] **SEC-017: Least-privilege database roles.** Separate runtime and migration
  authority and require encrypted service connections.
- [ ] **SEC-019: Idempotent GitHub retries.** Claim deliveries atomically and
  make database, realtime, and notification effects durable and idempotent.
- [ ] **EXP-001: Reliable PDF export.** Normalize attachment URLs, bound remote
  images, await generation and download, and verify the result end to end.
- [ ] **PRIV-002: Web Vitals minimization.** Add operator controls and sampling,
  reduce recorded attribution, document retention, and test deletion and abuse
  limits.
- [ ] **REL-001: Operational readiness.** Split liveness from readiness, require
  configured capabilities, and document and schedule retention work.
- [ ] **MCP-001: Accurate tool annotations.** Mark destructive, read-only,
  idempotent, and open-world behavior correctly for every MCP tool.
- [ ] **CI-002: Immutable CI inputs.** Pin actions and container images, declare
  least-privilege workflow permissions, and avoid persisted credentials.
- [ ] **REL-002: Repeatable releases.** Define versioning and compatibility,
  publish changelogs, signed artifacts, images, SBOMs, provenance, and upgrade
  notes.
- [ ] **CFG-001: One configuration contract.** Consolidate capability-aware
  validation and add a `doctor` command that reports missing requirements.
- [ ] **DOC-001: Tested operator documentation.** Verify quickstarts and publish
  architecture, configuration, backup, restore, upgrade, and incident runbooks.
- [ ] **REPO-001: Consistent contributor policy.** Align agent instructions,
  generated files, test placement, Biome exceptions, and CI enforcement.

## Deferred P2 work

- [ ] **INT-002: Slack requalification.** Slack stays disabled and absent from
  supported claims until OAuth, events, permissions, delivery, and end-to-end
  behavior are repaired in a separate project.
- [ ] **REPO-002: Large module cleanup.** Split oversized services and normalize
  test-support placement only after behavioral safety nets exist.

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
