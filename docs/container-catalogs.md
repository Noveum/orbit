# Container catalogs

Orbit's catalog deployment runs the Node web application, realtime service and
scheduler behind a Caddy gateway. PostgreSQL, Redis and private MinIO storage
have persistent volumes. Password signup is enabled; no demo users are seeded.

The runtime image applies the committed database migrations before starting the
web server. A failed migration prevents startup. Back up PostgreSQL and object
storage before upgrading. Keep the authentication, database and storage secrets
stable across upgrades.

Build from the repository root:

```sh
docker build -f deploy/docker/Dockerfile.catalog -t orbit-runtime .
docker build -f deploy/docker/Dockerfile.gateway -t orbit-gateway .
```

The build uses non-secret placeholders. Supply real settings at runtime. Bind
one HTTPS domain to the gateway's port 3000 and a separate HTTPS storage domain
to MinIO's port 9000. Set `ORBIT_APP_URL` and `ORBIT_STORAGE_URL` to these origins.
Do not expose PostgreSQL, Redis, the web service or the realtime service directly.
The bucket initializer persists the CORS allowlist and waits for it to load.

Generate distinct random `POSTGRES_PASSWORD`, `MINIO_PASSWORD`,
`BETTER_AUTH_SECRET` and `CRON_SECRET` values. `ORBIT_IMAGE` and
`ORBIT_GATEWAY_IMAGE` identify the same tested source commit. Catalog infrastructure
images use immutable digests. Image publication currently targets Linux amd64;
local source builds also work on Linux arm64.

Run exactly one scheduler. Configure Resend and a verified `EMAIL_FROM` to enable
email invitations and recovery. Configure OAuth providers separately if needed.
Restrict signup with `ALLOWED_EMAIL_DOMAINS` before opening a private installation.

The gateway trusts private proxy addresses in the platform templates. Deploy it
behind the platform's isolated ingress network, and narrow `ORBIT_TRUSTED_PROXIES`
to the actual ingress addresses when the network contains untrusted tenants.

The hosted Orbit MCP URL is **https://orbit.noveum.ai/mcp**. A self-hosted
installation provides its own MCP endpoint at its HTTPS app origin plus `/mcp`.
The GitHub repository is application source, not an MCP connection URL.

Container images are built by the Container images workflow from `containers-*`
tags and published with immutable source-commit tags. Catalog acceptance and
public template availability are recorded separately from a submitted pull
request. Paid infrastructure must be provisioned by the person deploying Orbit.
