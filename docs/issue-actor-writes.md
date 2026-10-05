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
edited. Legacy columns and the expanded foreign keys remain installed.
Human mirrors on mixed Actor rows are repaired independently. A baseline
initializes historical Owner only when the Human Creator canonical fields
were never initialized. An existing canonical row's NULL Owner stays NULL.

Real Agent-created Issues have `creator_id = NULL`. Shared response schemas,
REST, MCP, bootstrap, Realtime, cached rows and UI readers accept that value
and retain the canonical Actor display from PR2.

`ORBIT_AGENT_ISSUE_WRITE` defaults off and is enabled only by the exact value
`true`. It is independent of event delivery. Stage A does not enable Agent
write scopes or tools. `ORBIT_AGENT_MCP=true` can retain valid read-only Agent
connections while Issue writing is disabled.

## Deployment order

1. Complete the separate PR3 compatibility and identity-binding rollout in
   [MCP grant rollout](./mcp-grant-rollout.md). Do not skip its stage 3a release.
2. Keep `ORBIT_AGENT_ISSUE_WRITE` off. Run `bun run db:release` and
   `bun run db:check-drift` from the stage A or newer checkout.
3. Upgrade every Issue reader and Human writer, including REST, background
   adapters, bootstrap, Realtime and MCP instances. Upgrade all consent,
   token exchange and refresh instances before offering Agent write consent.
4. Verify legacy Human writes and real-null Agent reader fixtures before
   authorizing any Agent to write.

## Rollback

Before Agent business rows exist, keep the expanded schema while recovering
the deployment. After Agent rows exist, disable `ORBIT_AGENT_ISSUE_WRITE`
first and retain a PR4 version capable of reading and editing those rows.
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
