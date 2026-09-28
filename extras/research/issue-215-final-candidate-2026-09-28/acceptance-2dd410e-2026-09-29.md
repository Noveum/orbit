# Issue #215 final candidate acceptance

Date: 2026-09-29

Status: **NOT_READY**

The source candidate passed the complete workspace verification, database CLI drill, two-stage HTTP MCP release drill, real S3 checks, and persistent Outbox Worker smoke. The full ordinary browser E2E suite still has five failures on its second full run. The isolated MCP settings case passed, but the remaining browser failures are not all explained well enough to call the full acceptance ready.

## Candidate and upstream

- Source candidate: `2dd410e631fe9c32cada14d7aeb05f35ed49866a` on `feature/issue-runtime`.
- Upstream baseline: `41691a5cc32e2e2531eea2dd96d3ae18243949fc`.
- `git merge-base --is-ancestor 41691a5cc32e2e2531eea2dd96d3ae18243949fc HEAD` succeeded.
- `git ls-remote upstream HEAD refs/heads/main refs/heads/master` returned `41691a5cc32e2e2531eea2dd96d3ae18243949fc` for `HEAD` and `main`; upstream had not moved at closeout.
- The only database migration additions since the baseline are `0030_green_shaman.sql`, its snapshot, and the appended journal entry. Migrations `0017` through `0029` are unchanged.
- No source, dependency, runtime configuration, or migration changes were made during this acceptance turn. This file is the only intended repository change from closeout.

## Environment

Docker Desktop had been restarted earlier after the user's authorization. At closeout the CLI and daemon were responsive on context `desktop-linux`, Docker client and server `29.8.0`.

The acceptance environment was isolated from the existing `orbit-postgres`, `orbit-redis`, and `orbit-minio` containers:

- PostgreSQL `orbit215-accept-pg-7a36d3b8`, host port `15435`.
- Redis `orbit215-accept-redis-7a36d3b8`, host port `16381`.
- LocalStack `orbit215-accept-s3-7a36d3b8`, host port `14567`, healthy, with `S3_SKIP_SIGNATURE_VALIDATION=0`.
- Dedicated network `orbit215-accept-7a36d3b8`.
- Original task bucket `orbit-issue215-final-7a36d3b8`. A second task-only browser bucket `orbit-issue215-e2e-20260929-7a36d3b8` was created with exact production and `http://127.0.0.1:23000` CORS origins after the first browser run exposed the missing local origin.
- Ordinary E2E and release E2E used unique `ORBIT_TEST_LANE` values. The release phases reused the same lane.
- Task PostgreSQL, Redis, LocalStack, and runner were used for acceptance only. Shared containers were not restarted or stopped. No production credentials, database, S3, public ingress, or paid resources were used.

## Complete verify failures and resolution

The earlier Windows run had 72 passing and 6 failing checks. That was not a full workspace run. The six failures were environment and platform failures, not evidence of a product regression:

| Failure | Observed evidence | Resolution |
| --- | --- | --- |
| Three container manifest fixture cases | Windows Bun shim was invoked by the Linux Bash fake-Docker fixture and exited `127` with `cannot execute: required file not found`. No GHCR request was made, so the previously observed GHCR `403` was not the common cause. | Ran the same POSIX-dependent checks in the Linux task runner. The three cases passed without changing assertions. |
| File mode assertion | Windows produced `0666` where the POSIX confidentiality assertion requires `0600`. | Ran on Linux. The `0600` security requirement was retained. |
| Two symlink cases | Windows symlink creation failed with `EPERM`. | Ran on Linux. Both passed; Windows `EPERM` was not converted to a pass. |

On source SHA `2dd410e`, the first complete verify using the host-forwarded PostgreSQL route timed out two core database tests at 20 seconds. Both tests passed in a targeted rerun. The full verify then ran on the same SHA with the PostgreSQL connection routed internally over the isolated Docker network and passed. The cause was database round-trip latency through the host-forwarded port.

The complete Linux run executed all workspace packages: shared `367`, realtime-client `16`, db `365`, realtime-server `120`, services `893`, core `1167`, realtime `49`, mcp-server `223`, and web `2976`, for `6176` package tests. All passed. The remaining static checks in `bun run verify` also passed. The workspace test run was complete, not an early exit.

## Acceptance checks

| Check | Environment and evidence | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Linux task runner, Bun `1.3.14`, source SHA `2dd410e`; 859 installs across 1034 packages, no changes | Pass, along same-SHA evidence |
| `bun run verify` | Linux task runner, internal PostgreSQL route, source SHA `2dd410e`; all 9 packages ran, 6176 tests passed | Pass, along same-SHA evidence |
| `bun run build` | Linux task runner, source SHA `2dd410e`; Next.js production build and realtime bundles including `outbox-worker.js` completed | Pass, along same-SHA evidence |
| `bun run docs:build` | Linux task runner, source SHA `2dd410e` | Pass, along same-SHA evidence |
| `bun test docs/tests/navigation.test.ts` | Linux task runner, source SHA `2dd410e`; 1 test passed | Pass, along same-SHA evidence |
| `git diff --check` | Source diff from upstream baseline and final report diff | Pass |
| Database CLI: fresh release | Isolated database `orbit215_final_fresh_7a36d3b8`; first release applied and recorded 31 migrations | Pass |
| Database CLI: repeated release | Same fresh database; 0 migrations applied, 31 recorded | Pass |
| Database CLI: catch-up and drift | Same fresh database; `agent-actors.sql` twice, then drift check | Pass; catch-up was repeatable |
| Database CLI: exact upstream prefix | Baseline archive at `41691a5` released 30 migrations. Seeded representative historical Human issue, activity, grant, token, consent, audit, notification, and subscription rows. Candidate release applied only `0030`. Repeated release applied 0; catch-up twice and drift check passed. | Pass |
| Migration backfill and invalidation | Historical Human issue owners and timestamps remained; activity principal was backfilled; active grant was revoked with `agent_identity_required`; old access-token rows were absent; consent, audit, notification, and subscription history remained. No historical outbox rows were fabricated. | Pass |
| Unknown or illegal migration ledger | No ledger was manually altered. Fail-closed ledger cases ran in the database package during the complete verify. No bridge for the unsupported old #215 development lineage was added. | Pass by package evidence |
| Ordinary browser E2E collection | Windows host, task-only lane and bucket, trace disabled, screenshots and error contexts kept in task Temp. `--list` showed 59 tests across 23 files and did not collect either dedicated HTTP MCP spec. | Collection check passed |
| `bun run test:e2e`, first full run | 50 passed, 3 skipped, 6 failed. The two attachment failures were caused by the task bucket allowing only the production origin while the browser ran at loopback. | Failed; environment cause identified |
| `bun run test:e2e`, rerun with isolated browser bucket | 51 passed, 3 skipped, 5 failed. Both attachment tests passed with the exact loopback origin added to a new task bucket. | Failed; full ordinary suite remains red |
| MCP settings focused E2E | Fresh isolated lane, same source SHA and browser setup; `OAuth consent creates an agent that can be managed from MCP settings` passed 1/1. | Pass |
| `bun run test:e2e:agent-release` | Windows host, unique lane `issue215-agent-release-20260929-7a36d3b8`, task PostgreSQL/Redis/S3 and loopback origin. Writer-on passed 1/1, then Writer-off passed 1/1 in a fresh Next.js and Playwright process. | Pass |
| HTTP MCP Writer-on behavior | Real HTTP OAuth and MCP flow: 3 dynamic registrations, 5 authenticated OAuth flows, `tools/list`, `get_me`, `create_issue`, `update_issue`, `list_agent_issues`; lifecycle denials were checked. | Pass |
| HTTP MCP Writer-off behavior | Only ran after Writer-on succeeded. Same lane, database, origin, and saved credential; no second seed. Fresh process had identity read and consent enabled, issue writer disabled, outbox dispatch enabled. Agent read passed, Agent issue write was denied, Human issue write passed. | Pass |
| `bun test packages/services/tests/storage/round-trip.test.ts` | Linux task runner, LocalStack server signature validation enabled. 8 tests passed, including all 5 real S3 presign/PUT/GET, size, content-type, and CORS checks. No skip. | Pass |
| Outbox Worker image and entrypoint | Built `orbit215-outbox-worker:2dd410e` from current source. Image command was `bun apps/realtime/dist/outbox-worker.js`; a persistent task container actually ran it against `orbit215_worker_7a36d3b8` and the task Redis. | Pass |
| Outbox backlog and payload | Three queued events were delivered and marked in the database. A Redis subscriber observed the payloads; neither `grantId` nor `grant_id` appeared. | Pass |
| Duplicate delivery | Requeued one delivered test event with the same event ID. Redis observed that event ID twice. The targeted realtime-client test `drops duplicate event ids and older aggregate versions while retaining legacy events` passed 1/1. | Pass |
| Worker failure, retry, and restart | Injected an unavailable task Redis endpoint on port `6399`. The worker recorded two retry attempts and `maxRetriesPerRequest`; the faulty task worker stopped. Restarted the original worker container with the correct task Redis URL. The same event was then observed on Redis, marked delivered, and had no last error or grant identifiers. | Pass |

The first Worker WebSocket observer harness timed out while waiting for its combined client callback condition, although the database showed successful publication. A direct Redis subscriber then verified actual delivery, redaction, and duplicate event IDs; the client duplicate-ID test passed separately. The first manually inserted retry fixture also used an invalid timestamp and correctly failed closed as a redaction error. The fixture was corrected to a valid UTC `Z` timestamp before the Redis outage and recovery check. Neither harness issue required a source change.

## Ordinary browser E2E residual failures

The second full run still failed these five tests. Failure contexts and screenshots are retained under `%TEMP%\orbit215-final-7a36d3b8\playwright-ordinary` and `playwright-ordinary-retry`. Playwright trace was disabled and persisted logs were scrubbed for credentials.

| Test | Observed failure | Assessment |
| --- | --- | --- |
| `account-and-workspaces.spec.ts` | `passkey-list` did not appear after the virtual-authenticator flow. | Unresolved browser/passkey failure. Not part of #215. |
| `board-drag.spec.ts` | ArrowRight left status at `Picked up ENG-23` instead of `Moved ENG-23`; appeared only on the rerun. | Unresolved full-suite failure, likely timing or keyboard interaction. Not part of #215. |
| `doc-experience.spec.ts` | After access revocation, `doc-reader` remained in the page DOM, expected count 0 and received 1. | Unresolved behavior outside #215. |
| `inbox-layout.spec.ts` | Strict locator found two `inbox-detail` elements in responsive markup. | Test selector ambiguity; assertion was not weakened. Outside #215. |
| `mcp-settings.spec.ts` | Full-suite context navigated to team `N8`, while the `Orbit Demo` UI had Design, Engineering, and Marketing and returned “No such team”. | Full-suite workspace/test-state mismatch. The same OAuth agent test passed 1/1 in a fresh isolated lane, and the dedicated two-stage HTTP MCP release test passed. |

The S3 configuration failure from the first run was removed by switching to the task-only bucket; no application CORS rule or assertion was relaxed. The other ordinary-suite failures remain, so the ordinary browser suite is not accepted as green.

## Resource state and closeout

- No test process remained on application ports `23000` or `23101` after E2E completion.
- The task PostgreSQL, Redis, and LocalStack containers were stopped gracefully with exit code 0. The ephemeral Linux runner was removed automatically when stopped. The normal Outbox Worker and two clean fault containers exited 0; the deliberately unavailable-Redis Worker required Docker's stop timeout and ended with exit 137. All Worker containers are stopped.
- The stopped containers preserve the task data. No database, bucket, or volume was dropped or deleted. Preserved databases include `orbit215_final_fresh_7a36d3b8`, `orbit215_final_prefix_7a36d3b8`, `orbit215_worker_7a36d3b8`, the five issue-215 E2E lane databases (`orbit_test_web_issue215fina60b2ac75`, `orbit_test_web_issue215e2e2ee9928e4`, `orbit_test_web_issue215e2erbd00e9b4`, `orbit_test_web_issue215agen11af4ee0`, and `orbit_test_web_issue215mcppd18299ef`), and the earlier task probe databases `orbit215_fresh_7a36d3b8`, `orbit215_prefix_7a36d3b8`, `orbit215_pushprobe_7a36d3b8`, and `orbit215_upstream_probe_7a36d3b8`.
- Preserved buckets are `orbit-issue215-final-7a36d3b8` and `orbit-issue215-e2e-20260929-7a36d3b8`. The PostgreSQL volume `orbit215-pgdata-7a36d3b8` and the ten task `orbit215-node-*` dependency volumes remain. The task network and built image `orbit215-outbox-worker:2dd410e` remain.
- Older stopped runner and setup containers from earlier attempts were left untouched: `orbit215-linux-verify5-541168b-7a36d3b8`, `orbit215-linux-verify4-f41b9d3-7a36d3b8`, `orbit215-linux-verify3-f41b9d3-7a36d3b8`, `orbit215-jq-install-7a36d3b8`, `orbit215-linux-verify2-f41b9d3-7a36d3b8`, `orbit215-linux-verify-f41b9d3-7a36d3b8`, and `orbit215-linux-verify-f41b9d3`.
- The unused created Node helper container had no mounts and was removed. No volume was removed. Shared `orbit-postgres`, `orbit-redis`, and `orbit-minio` remain running and untouched.
- The release script removed its private token/results directory in its `finally` cleanup. Synthetic task environment files and temporary launch scripts were removed. Failure screenshots, error contexts, and scrubbed logs remain under `%TEMP%\orbit215-final-7a36d3b8`; Playwright trace was disabled and no trace archive remains.
- Production OAuth, production S3, public network ingress, and deployment were not tested. They remain release conditions.
## Decision

**NOT_READY** because the full ordinary browser E2E suite still has five failures. The #215 database, real HTTP MCP Writer-on/Writer-off, S3, and Outbox Worker checks passed on source SHA `2dd410e`; resolve or independently disposition the ordinary E2E failures before calling the candidate ready for PR.
