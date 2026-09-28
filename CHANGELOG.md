# Changelog

Orbit uses dated source releases: `YYYY.MM.DD`, with `-2`, `-3`, and so on for
additional releases on the same UTC day. Dates identify source snapshots, not
semantic-version compatibility guarantees. Self-hosting remains **Preview**.

This history covers every published release, including the initial source
snapshot. Each entry links to the exact changes and its GitHub release.
See [Releasing and upgrading Orbit](docs/releases.md) for the release process,
upgrade steps, and compatibility limits.

## 2026.09.08

### Added

- Similar-issue suggestions while creating an issue, using title similarity
  within the selected team and the current user's permissions. Suggestions open
  the existing issue for review. [#379](https://github.com/Noveum/orbit/pull/379)
- A workspace project updates feed under **Projects > Updates**, bringing
  project health reports together with links to their projects.
  [#372](https://github.com/Noveum/orbit/pull/372)
- Members and admins can delete other people's comments, with authorization
  enforced on the server. [#399](https://github.com/Noveum/orbit/pull/399)

### Fixed

- Duplicate suggestions disappear as soon as an issue is submitted.
  [#429](https://github.com/Noveum/orbit/pull/429)
- Isolated issue failure tests and restored workspace provider mocks to prevent
  test files from affecting one another.
  [#426](https://github.com/Noveum/orbit/pull/426),
  [#438](https://github.com/Noveum/orbit/pull/438)

### Changed

- Vercel preview builds follow pull request readiness, with an operator guide
  for the deployment gate. [#341](https://github.com/Noveum/orbit/pull/341)
- Updated the Next.js and React dependency group and GitHub Actions.
  [#431](https://github.com/Noveum/orbit/pull/431),
  [#433](https://github.com/Noveum/orbit/pull/433)
- Defined analytics lead and cycle time and removed unused analytics components.
  [#400](https://github.com/Noveum/orbit/pull/400),
  [#427](https://github.com/Noveum/orbit/pull/427)
- Refreshed the README and demo screenshots, backfilled the release history,
  and documented source releases and upgrades.

### Upgrade notes

No new database migration or environment variable is introduced relative to
`2026.09.06`. Duplicate suggestions use PostgreSQL's `pg_trgm` extension, which
is part of the existing database setup. Run the normal database release check
before deploying. Self-hosting remains Preview; this release does not enable
Slack globally or complete the production readiness checklist.

[GitHub release](https://github.com/Noveum/orbit/releases/tag/2026.09.08) ·
[Full changes](https://github.com/Noveum/orbit/compare/2026.09.06...2026.09.08)

## 2026.09.06

### Added

- Global Slack capability controls with separate authorized connections,
  encrypted credentials, and delivery boundaries for each Orbit organization.
  [#373](https://github.com/Noveum/orbit/pull/373)
- Slack member synchronization for every workspace member with a unique matching
  email, plus an admin action to refresh those mappings.
  [#382](https://github.com/Noveum/orbit/pull/382)
- MCP Registry publication, a Smithery server card, and canonical directory
  metadata. [#386](https://github.com/Noveum/orbit/pull/386),
  [#389](https://github.com/Noveum/orbit/pull/389),
  [#396](https://github.com/Noveum/orbit/pull/396)

### Fixed

- Slack channel lookup sends its arguments as query parameters.
  [#381](https://github.com/Noveum/orbit/pull/381)
- Attachment end-to-end tests wait for upload completion, and issue-card tests
  are isolated from leaked mocks.
  [#380](https://github.com/Noveum/orbit/pull/380),
  [#398](https://github.com/Noveum/orbit/pull/398)

### Changed

- Defined the provider-neutral realtime service boundary. The portable host and
  reconnect qualification remain future work.
  [#397](https://github.com/Noveum/orbit/pull/397)

### Upgrade notes

Apply the migration for unique Slack workspace ownership before enabling Slack.
Keep `SLACK_ENABLED` false or unset until the provider setup, credential
rotation, deployment, and live qualification steps in the
[Slack launch guide](docs/integrations.md#launch-order) are complete. Existing
connections may need reauthorization for the directory scopes used by member
sync. This source release does not establish production self-hosting support.

[GitHub release](https://github.com/Noveum/orbit/releases/tag/2026.09.06) ·
[Full changes](https://github.com/Noveum/orbit/compare/2026.08.30...2026.09.06)

## 2026.08.30

The first dated release establishes a source snapshot of Orbit's existing
product. The capabilities below summarize the accumulated history, rather than
claiming they all arrived on the release date.

### Product baseline

- Realtime issue lists and boards, keyboard drag and drop, filters and saved
  views, issue relations, sub-issues, attachments, and multiple reviewers.
- Workspace sprint planning, sprint history, standup by person, projects,
  milestones, and analytics for scope, throughput, and planning.
- Rich documents, collections, comments, Mermaid diagrams, self-contained HTML
  pages, artifact previews, and members-only published HTML links.
- Notification inbox with separate Activity and Status tabs, GitHub pull
  request activity, and the foundation for personal Slack notifications.
- OAuth-authenticated MCP tools for issues, planning, documents, integrations,
  analytics, and workspace agent instructions.
- Passkeys, email codes, Google and GitHub sign-in, optional passwords,
  workspace membership, server-side policy, and light and dark themes.

### Operations and quality baseline

- One Next.js app for the reference Vercel deployment, with realtime and MCP
  packages, PostgreSQL, Redis, and S3-compatible storage.
- Guarded database releases, schema drift checks, a protected demo seed,
  isolated test database lanes, and CI for lint, types, tests, migrations,
  builds, and browser flows.
- Searchable documentation, contribution and security guidance, Apache-2.0
  licensing, and explicit Preview self-hosting boundaries.

### Upgrade notes

Install this snapshot with Bun and follow the
[database release guide](docs/database-releases.md) for an existing database.
Do not use the demo seed to upgrade a database: it resets its target. Earlier
unversioned checkouts can require migration reconciliation; inspect the full
history and the [readiness tracker](docs/open-source-readiness.md) before
planning a deployment.

[GitHub release and original change list](https://github.com/Noveum/orbit/releases/tag/2026.08.30) ·
[Complete history through this snapshot](https://github.com/Noveum/orbit/commits/2026.08.30/)
