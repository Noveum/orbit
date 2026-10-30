# MCP grant compatibility rollout

Stages 3a and 3b are submitted together in one pull request based on released main.
Production still requires two separate rollout stages. Preserve a deployable
stage 3a artifact before deploying the final stage 3b checkout.

## Stage 3a: compatibility preparation

Start from published main commit `4f904217441616002e96dfcf76ed3b95b0b8a905`.
Keep its released migrations through `0033_polite_lord_tyger`, including
`0030_actor_schema_expand` and `0031_broad_lifeguard`, their snapshots and
journal entries unchanged. The actor expansion
preserves all Owner values, including NULL.
Apply migration `0034_mcp_grant_compatibility` before deploying stage 3a.
The PR1 binary continues to use its global client/user index and old columns.
No grants, tokens or consents are revoked by the migration. No identities are
created. PR1 identity fixtures and nullable owner/client references stay valid.

The global `mcp_grant_client_user_unique` remains installed. An additional
partial `mcp_grant_legacy_unique` supports the stage 3a legacy upsert after
stage 3b removes the global index. Legacy reauthorization replaces its grant
version and removes only tokens bound to that version or old nullable legacy
tokens for that client/user. Revocation uses the exact grant ID.

Old `orbit-mcp-v1` access and refresh credentials retain their encoding and
Human principal and scope behavior. The nullable token grant reference can
fall back to client/user matching only for a legacy grant. Newly issued tokens
persist an exact grant reference.

Agent credentials use `orbit-mcp-agent-v2`, which the PR1 parser rejects.
Authentication requires explicit agent mode, exact token/grant binding,
identity/client/owner/workspace agreement and the original membership ID.
Missing identity references, a deleted identity, disabled client, removed
membership or `ORBIT_AGENT_MCP` other than `true` fail closed. They never become
Human credentials. New agent authorization is unavailable in stage 3a,
including when the runtime gate is enabled. Stage 3a rejects any explicit
agent consent field, including requests from a cached stage 3b page. Mixed
instances and rollback cannot silently authorize that request as legacy.

Agent tools have read-only scopes and are checked at registration and execution.
The inbox conversation tool has internal write side effects and is unavailable
to agents. `get_me` continues to describe the Human principal;
`get_agent_identity` explicitly describes the agent without exposing credentials.

Consent display and finalization load client, owner, redirect, scopes and PKCE
context from the stored authorization request. Finalization consumes that
request in a transaction. Token issuance uses the provider's PKCE and client
checks, followed by a transaction that rechecks current grant, identity,
membership and token data before returning wrapped credentials. A failed
post-issuance check deletes the newly issued token. Refresh consumption and
revocation are serialized by the same owner advisory lock.

All grant mutations and credential acceptance take the owner advisory lock
before mutable rows. Member removal takes its existing notification lock,
then that owner lock, then the member row lock. It revokes bound grants in that
workspace and preserves identity history and snapshots. The membership ID also
prevents a removed and rejoined owner from reviving an old grant.

## Stage 3b: deployment prerequisites

Deployable stage 3a artifact: commit
`8cc84621a17919f0340aaec674ae271a9ff7f980`. This source artifact contains
current main and compatibility migration `0034`, without `0035` or the
stage 3b consent runtime. It is retained as an ancestor of the final branches.
The earlier artifact `037e941376a42ba730e3d75d974ad1f6bbc415ca` remains
unchanged for historical reference; its old migration ledger cannot upgrade
the current main baseline. Build and verify the new exact artifact for each
target environment before proceeding.
Use branch `feature/agent-consent-binding` for the final stage 3b artifact.
Record the exact verified commit from that branch before release and build,
then deploy the runtime built from the same checkout.

Migration `0035_mcp_agent_grant_binding` removes only the old global unique
index and adds one active agent grant per identity. It preserves the legacy
partial index, all credentials, consent records, identities and historical
grants. Release also reconciles this explicitly retired index when baselining
a missing or partial ledger, and on repeated releases after index drift. It
does not remove unrelated undeclared indexes.

Stage 3b must be a separate release based on completed stage 3a, even when
both stages are reviewed in one pull request. First release the main baseline
and deploy its runtime. The final checkout's `bun run db:release` applies every
pending migration, including both `0034` and `0035`; it does not pause for stage
3a deployment. First use the stage 3a checkout and release artifact to apply
`0034` and upgrade all related instances. Only then use the final checkout to
apply `0035` and deploy stage 3b. Follow
this sequence before merging schema-dependent code into a deployment branch.
Before its migration, confirm all web and MCP instances run stage 3a or later,
including instances which serve consent, token exchange and refresh. Keep
`ORBIT_AGENT_MCP` disabled during migration and deployment. Never run the stage
3b migration while a PR1 instance can still upsert by the global client/user
index or broadly delete that pair's tokens.

Stage 3a runtime uses the partial legacy conflict target and works after the
global index is removed. Old release/build drift checks still describe their
own schema: run release verification with the schema for the stage being
deployed, not an older checkout against a newer migration ledger.

After migration and successful stage 3b verification, deploy stage 3b with
the gate still disabled. Enable `ORBIT_AGENT_MCP=true` only after every
consent instance runs stage 3b, every token and MCP instance is at least stage
3a, and the global index is absent. Stage 3a rejects agent consent requests
during a mixed rollout or rollback. This flag opens explicit identity consent
and authentication, never agent writes.

Consent defaults to the legacy Human connection. The owner can explicitly
choose read-only agent mode, enter an identity name or select an existing
identity belonging to that owner, workspace and registered client. Names are
not inferred from client names; there is no identity quota. An identity cannot
be reassigned to another client through consent. Bound consent requires a
trusted S256 PKCE context and a requested `orbit.read` scope. Granted scopes
are the requested supported scopes, including `orbit.read` and excluding
`orbit.write`.
The displayed permissions, authorization code, consent row, grant, access
token, refresh token and MCP tool set agree on this restriction.

Reauthorization revokes only the selected identity's old active grant, keeps
that grant's history, and creates a new immutable version. Legacy upsert,
another identity or another workspace cannot overwrite this version. The
connection settings display the identity name so that the owner can select
the exact connection to disconnect. They expose no token secrets.

After agent grants exist, rolling back to PR1 code or recreating the global
unique index is unsafe: multiple agent/workspace grants can share a client/user.
Disable the gate to stop agent authorization and authentication; legacy
connections continue to work. A prebuilt stage 3a runtime can serve legacy and
validate the new format, but does not expose agent consent. Keep the expanded
database and the partial legacy index. Do not convert agent grants to legacy
or delete historical identities as a rollback operation.

## Local validation

Use separate `ORBIT_TEST_LANE` values for each stage and concurrent suite.
Prepare only those lane databases when schemas differ. `db:test-setup` resets
all six base databases regardless of lane and must not run during parallel work.
The rollout tests exercise PR1 SQL on the expanded database, unchanged old
business rows, minimum identity insertion, repeat release and drift detection.
Runtime tests exercise old credentials, scopes, mode isolation, exact grant
revocation, membership removal and refresh races. No production database or
deployment gate is changed by these tests.

The existing document import test polls the button's boolean disabled state
before retaining its original accessibility assertion. A failed assertion on
the busy Happy DOM element otherwise formats tens of megabytes of accumulated
document state and can exhaust the unchanged test timeout. All original
assertions remain, with an additional check that an oversized file is rejected
before its contents are read. No document import behavior changes.

Stage 3b tests cover several identities for one client/user across workspaces,
explicit names, client takeover rejection, nullable owner/client rejection,
selected identity reauthorization and preserved snapshots. The real provider
flow covers lowercase `s256`, v2 access and refresh, persisted grant binding
and read-only scopes. The consent race test uses separate database connections
and observes an ungranted PostgreSQL advisory lock before releasing competing
duplicate and distinct authorization requests. All original assertions remain.

The rollout baselines include the released `0031_broad_lifeguard` migration.
Stage 3a upgrades its 34-migration baseline with `0034`; stage 3b upgrades its
35-migration compatibility baseline with `0035`. Both exercise repeat release
and compare the resulting live catalog with the schema declared for that stage.
