# MCP grant compatibility rollout

## Stage 3a: compatibility preparation

Start from published main commit `4f904217441616002e96dfcf76ed3b95b0b8a905`.
Keep its released migrations through `0033_polite_lord_tyger`, snapshots
and journal entries unchanged, including `0030_actor_schema_expand` and
`0031_broad_lifeguard`. The actor expansion
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

Stages 3a and 3b may be reviewed together, but require separate release and
deployment artifacts. This checkout contains `0034_mcp_grant_compatibility`
and the stage 3a runtime, without the stage 3b migration or consent runtime.
Release the main baseline and deploy its runtime first. Then use this stage 3a checkout to
apply `0034` and deploy its runtime to all related instances. Only afterward
release and deploy stage 3b from its separate checkout. Running release from
the final stage 3b checkout applies all pending migrations without pausing for
the required intermediate stage 3a deployment.

The earlier stage 3a artifact `037e941376a42ba730e3d75d974ad1f6bbc415ca`
retains its original migration history. Its release command cannot upgrade
the newer main ledger. Use this current-main compatibility artifact for the
34-migration baseline and record its exact commit before release and build.

Before its migration, confirm all web and MCP instances run stage 3a or later,
including instances which serve consent, token exchange and refresh. Keep
`ORBIT_AGENT_MCP` disabled during migration and deployment. Never run the stage
3b migration while a PR1 instance can still upsert by the global client/user
index or broadly delete that pair's tokens.

Stage 3a runtime uses the partial legacy conflict target and works after the
global index is removed. Old release/build drift checks still describe their
own schema: run release verification with the schema for the stage being
deployed, not an older checkout against a newer migration ledger.

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
