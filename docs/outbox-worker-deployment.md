# Agent issue outbox worker

The issue outbox needs a persistent process to deliver Agent issue changes to
Redis promptly. The Vercel Cron route is a recovery path for events left behind
while the worker is unavailable.

Build the worker image from the repository root:

```bash
docker build -f apps/realtime/Dockerfile -t orbit-issue-outbox .
```

Run one persistent instance with these environment variables:

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | Production Postgres runtime connection string |
| `REDIS_URL` | Production Redis connection string, using TLS where supported |
| `ORBIT_ISSUE_OUTBOX_DISPATCH` | `true` |

The worker exits at startup when the feature gate is absent or false. Deploy the
same gate to the web app so the Cron recovery route can run. Keep the worker
connected to the same Postgres and Redis used by the web app. Use the host's
restart policy, send `SIGTERM` for shutdown, and alert on worker exit and the
`issue outbox redaction failure` log signal. The Cron response includes the
separate `redactionFailures` statistic.

Do not enable Agent issue writes until the persistent worker is running and the
production connections are confirmed. The repository supplies the worker image
and runtime; the deployment host must supply the persistent service and
production secrets.
