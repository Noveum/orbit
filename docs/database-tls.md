# Verified database TLS

Set `DATABASE_REQUIRE_TLS=true` to require encrypted PostgreSQL connections with certificate and hostname verification. The default is `false`, preserving local Docker connections. Enabling the policy does not change credentials, prepared statements, pool limits or timeouts.

The required policy takes precedence over weaker `ssl` or `sslmode` URL options and `PGSSL` settings. It refuses `NODE_TLS_REJECT_UNAUTHORIZED=0` and unsupported certificate-file or TLS-negotiation query options. There is no plaintext fallback and no unverified `require` mode.

Public certificate authorities normally use the runtime's standard trust store. If the database requires an additional certificate authority, set `DATABASE_TLS_CA_PEM` to the public PEM certificate or certificate chain. The policy adds these certificates to standard trust. It accepts certificate blocks only, never private keys. Omit this variable when it is unnecessary; it requires `DATABASE_REQUIRE_TLS=true`.

The app pool, schema guard, migration release, catchup tooling and PostgreSQL connections in backup and recovery code use the same policy. The policy is provider independent. Obtain any additional public CA certificate from the database provider's official documentation, verify its fingerprint, and preserve hostname verification. A changed policy or CA creates a different application pool cache key.

Native `pg_dump` and `pg_restore` connections force `sslmode=verify-full` in the connection URL. Their standard and additional public CA bundle lives in a private temporary directory for that operation, with owner-only file access, and is removed after success, failure or cancellation. Passwords remain outside command arguments.

Configuration errors contain a fixed message and do not include connection strings or certificate material. Deploying this code alone leaves existing connections unchanged. Enable the required policy only after a staged deployment verifies connectivity with the intended certificate authority and endpoint.
