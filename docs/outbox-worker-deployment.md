# Agent issue outbox worker

The issue outbox needs a persistent process to deliver Agent issue changes to
Redis promptly. The Vercel Cron route is a recovery path for events left behind
while the worker is unavailable.

The worker is separate from the local WebSocket host in the same workspace.
Production WebSockets remain at the Web app's `/api/ws`; the worker does not
serve sockets or HTTP. See the [release runbook](issue-215-release-runbook.md)
for migration, gate ordering and rollback.

## Build and run

Build the worker image from the repository root, using the same candidate as Web:

```bash
docker build -f apps/realtime/Dockerfile -t orbit-issue-outbox .
```

Run one persistent instance with these environment variables:

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | Production Postgres runtime connection string |
| `REDIS_URL` | Production Redis connection string, using TLS where supported |
| `ORBIT_ISSUE_OUTBOX_DISPATCH` | `true` |

The image starts `bun apps/realtime/dist/outbox-worker.js`. The worker exits at
startup when the feature gate is absent or false. Configure one persistent
instance with a restart policy, bounded log rotation and host-appropriate
resource limits. Supply secrets through the hosting platform, never image build
arguments or committed files. Send `SIGTERM` for planned shutdown.

Deploy the same dispatch gate to Web. The schedule in `apps/web/vercel.json`
invokes `/api/cron/issue-outbox` every minute as recovery; the route also requires
`CRON_SECRET`. Keep Web and Worker connected to the same Postgres database and
Redis deployment.

The worker drains, then waits one second before polling again. Its default
batch is 50 rows, with a 30-second lease. A row is acknowledged only after Redis
publish succeeds. Expired leases are reclaimable. Delivery is at least once:
a process can stop after publishing but before acknowledgement, so consumers
must deduplicate on `eventId`. Public events omit the internal grant reference.

## Monitoring

The image has no HTTP health endpoint or Docker `HEALTHCHECK`. Monitor:

- Process state, stable restart count and `issue outbox worker started` logs.
- Repeated `issue outbox worker drain failed`, `issue outbox redaction failure`
  and `issue outbox event exceeded retry threshold` logs.
- Authenticated Cron response statistics: `backlog`, `retrying`, `overThreshold`,
  `redactionFailures`, `oldestAvailableAt` and `maxAttempts`. Calling this route
  also drains eligible events; it is not a read-only health probe.
- Publish/ack latency against the service objective chosen for the deployment.

`oldestAvailableAt` is the earliest scheduled availability among pending rows,
not the original enqueue time. Retries change it. Rows at 10 or more attempts
remain queued and appear in `overThreshold`; there is no terminal dead-letter
state or separate `dead` metric. Investigate `last_error`, `available_at` and
`lease_until` rather than deleting pending events to clear an alert.

Do not enable Agent issue writes until the persistent worker is running and the
production connections are confirmed. The repository supplies the worker image
and runtime; the deployment host must supply the persistent service and
production secrets.
