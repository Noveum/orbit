# Auth provider upgrade

This release moves Better Auth, passkeys, and the standalone MCP OAuth provider together to 1.7.25. PostgreSQL remains on the existing 3.4.x driver. The new provider uses separate client, resource, token, consent, assertion, and signing-key tables. Existing application users, sessions, OAuth client IDs, workspace grants, and legacy token rows remain in place.

## Compatibility boundary

Ordinary signed-in browser sessions remain valid when the authentication secret is unchanged. Cached session data is checked against its actual session token. Passkey registration and sign-in retain their existing ceremony and update the verification timestamp only after a successful assertion. Mailbox verification for an unverified account intentionally removes unproven linked credentials and old sessions; a removed password must be reset through password recovery.

Existing MCP access credentials remain usable until their original access expiry while their current workspace grant and principal remain authorized. This release does not extend that expiry. Existing refresh credentials from the old in-core MCP provider cannot refresh after the new release takes over. Their holders must reconnect and approve the workspace again. A refresh row is not a count of distinct users. Disclose this reconnect requirement before promotion.

The old token records contain no original session binding. This release does not attach those credentials to an arbitrary current session. New credentials require a verified provider JWT with the configured issuer and MCP resource audience, the exact client, user, session and workspace grant, and the permitted tool scopes. Signing out or revoking a new refresh credential also makes its associated MCP credentials unusable.

The previous /api/auth/mcp authorize, register, token and revoke paths remain compatibility aliases. Discovery advertises the provider /api/auth/oauth2 paths. Both token paths apply the same workspace and Agent checks. MCP requests that omit a resource default to the configured MCP resource. A different requested resource remains subject to provider resource policy. Identity scopes belong in authorization-server discovery, while protected-resource discovery advertises orbit.read and orbit.write.

The client-data migration copies public clients without secrets and confidential web clients with their existing secret converted to the provider hash format. Unsupported client types and malformed metadata fail the migration. Existing new-provider records are never overwritten. A missing legacy client first encountered after the copy is inserted through the same narrow compatibility mapping, covering registrations between migration and promotion. Only these migrated clients retain the former Basic or POST secret compatibility; new registrations follow their declared authentication method.

A migrated client links to the configured MCP resource once. The migration marker is consumed under a client row lock. Retrying authorization or the data migration does not restore a resource link an operator subsequently removed. Disabled clients remain disabled.

## Release procedure

1. Review the exact source, dependency lockfile, additive schema migration and client-data migration together. Finish the full verification and exact-head CI checks against current main.
2. Announce the MCP reconnect requirement and restart any pending social OAuth or MCP authorization flows at cutover. Upgrade every participating OAuth Proxy environment together because its protected payload purpose changed upstream. Keep the authentication and proxy secrets unchanged for this release.
3. Apply the committed migrations through the repository database release command against the intended target, using an operator-owned environment file. Verify the migration ledger and the full schema drift check. Do not use a schema push as a replacement for the client-data backfill. A schema-preapplied installation also executes the client-data migration transactionally before recording it in its ledger. Invalid legacy metadata leaves that ledger unchanged.
4. Build the exact reviewed release. Confirm deployment readiness, then promote and verify the public alias points to that exact deployment. Retire backend access on the previous immutable deployment hosts. Any current-host cron exception must be updated through its separately reviewed firewall procedure; a deployment marked production is not proof that the public alias moved.
5. Check public health and discovery, an existing browser session, passkey sign-in, and a complete fresh MCP authorization with its workspace choice. Verify read and write scopes, refresh rotation, sign-out and grant revocation. Use test accounts and read-only application actions for production smoke checks.
6. Confirm late legacy registrations are either already copied or copied when their next authorization starts. A repeated client-data reconciliation may be used through a separately reviewed operational procedure, but it must preserve modern client state and cannot replace the lazy compatibility checks.

Do not leave a previous vulnerable auth deployment reachable through a backend hostname. An old request already in flight can complete after promotion and create a legacy token row. Such a credential has only its original access lifetime under the compatibility verifier, and its legacy refresh still fails closed on the new deployment. Inspect deployment-specific errors after cutover and distinguish old deployment completions from requests served by the new release.

## Rollback

The schema expansion is additive. Keep both new and legacy tables and the applied migration ledger when rolling application code back. Do not reverse or delete the client-data migration, signing keys, grants, sessions, or token rows as part of an application rollback.

The old application does not understand newly registered provider clients or provider refresh tokens. Credentials created under the new release therefore have no guaranteed refresh continuity after a rollback and may require another reconnect. A rollback also restores the upstream security risks addressed by this update. Prefer a forward fix; if a rollback is necessary, make its security exposure and reconnect impact explicit, verify the exact public alias, and retain the backend-host retirement rules.

## Upstream references

- [Better Auth 1.7 upgrade guide](https://www.better-auth.com/docs/guides/1-7-upgrade-guide)
- [Better Auth 1.7.25 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.25)
- [Better Auth 1.7.7 security release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7)
