# PostgreSQL 18 to 19 upgrade

Orbit's Docker definitions run `postgres:19-alpine`. The official image keeps each
major version in its own directory under `/var/lib/postgresql`, so a volume
created by PostgreSQL 18 holds its data in `/var/lib/postgresql/18/docker`. The
PostgreSQL 19 image refuses to start on such a volume and exits with:

```
Error: in 18+, these Docker images are configured to store database data in a
...
       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/18/docker
```

Nothing has been lost. Follow the section for your installation.

## Who needs this

| Installation | Action |
| --- | --- |
| Local development (`docker-compose.yml`) | Upgrade the volume, or reset it |
| Docker preview (`deploy/docker`) | Upgrade the volume |
| Catalog compose on a host where you can run `docker` | Upgrade the volume |
| Zeabur or another platform without `docker` access to the volume | Back up and restore into a new PostgreSQL 19 service |
| Managed PostgreSQL such as Supabase, Neon, RDS or Render | Nothing. Orbit runs on PostgreSQL 16 or newer, so upgrade on your provider's schedule. The Render blueprint stays on 18 until Render offers 19 |

## Upgrade a Docker volume

1. Capture a backup first with the [routine backup](routine-backup.md) procedure.
   The upgrade keeps the PostgreSQL 18 files, but an offsite archive is the
   recovery path if the host itself fails.

   If PostgreSQL 19 has already refused to start, the backup has no database to
   connect to. Start PostgreSQL 18 on the volume for the capture, point the
   backup's direct database connection at
   `postgres://orbit:<POSTGRES_PASSWORD>@127.0.0.1:5439/orbit`, and stop it
   afterwards:

   ```bash
   docker run -d --name orbit-postgres-18-backup -p 127.0.0.1:5439:5432 \
     -v orbit-preview_postgres:/var/lib/postgresql postgres:18-alpine
   docker stop orbit-postgres-18-backup && docker rm orbit-postgres-18-backup
   ```

   The empty `/var/lib/postgresql/19` directory the refused start left behind is
   harmless, and the upgrade removes it.
2. Stop every container that uses the volume. The command refuses to run while
   one is running.

   ```bash
   bun run infra:down
   bun run preview:down
   ```

   Use the line for your installation. For a catalog deployment, stop the stack
   from its platform or with `docker compose stop`.
3. Find the volume. It is `orbit_orbit-postgres` for local development and
   `<COMPOSE_PROJECT_NAME>_postgres` for the Docker preview, which is
   `orbit-preview_postgres` unless you changed the project name. Otherwise list
   the candidates:

   ```bash
   docker volume ls --filter name=postgres
   ```

4. Run the upgrade from the repository root:

   ```bash
   bun run postgres:upgrade-volume --volume orbit-preview_postgres
   ```

   It starts PostgreSQL 18 on the volume, dumps every database and the roles with
   the PostgreSQL 19 client, initializes PostgreSQL 19 in
   `/var/lib/postgresql/19/docker` on the same volume and restores into it. It
   then compares roles, password hashes, extensions and the exact row count of
   every table with the original, and only reports success when they all match.
   Any failure removes the new cluster and leaves the volume as it was. The dump
   is kept in a temporary directory, or in an empty directory you pass with
   `--dump-dir`. Pass `--user` when the superuser is not `orbit`.

   The volume needs free space for a second copy of the database. The restore
   rebuilds every index, so expect it to take about as long as a fresh restore of
   your largest backup.
5. Start the installation again with `bun run infra:up`, `bun run preview:up` or
   your platform, and sign in to confirm your workspace is there. The database
   password is carried over, so no setting changes.
6. Once you are satisfied, remove the PostgreSQL 18 files to reclaim the space:

   ```bash
   docker run --rm -v orbit-preview_postgres:/var/lib/postgresql \
     --entrypoint rm postgres:19-alpine -rf /var/lib/postgresql/18
   ```

Running the command again on an upgraded volume does nothing.

For local development you can instead discard the data with `bun run infra:reset`
and run `bun run db:push && bun run db:test-setup && bun run db:seed`.

## Platforms without access to the volume

Keep the old service on its PostgreSQL 18 image until the new one is ready.

1. Capture a backup of the PostgreSQL 18 database with the
   [routine backup](routine-backup.md) procedure, using a PostgreSQL 19 `pg_dump`.
2. Create a new PostgreSQL 19 service with a new, empty volume and the same
   `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`.
3. Restore the archive into it with the
   [region/provider migration](region-provider-migration.md) procedure, then point
   the web, realtime and scheduler services at the new database.
4. Delete the PostgreSQL 18 service and its volume only after sign-in, documents
   and attachments check out.

## Roll back

Until you delete the PostgreSQL 18 files, you can return to them:

1. Stop the installation.
2. Remove the PostgreSQL 19 cluster:

   ```bash
   docker run --rm -v orbit-preview_postgres:/var/lib/postgresql \
     --entrypoint rm postgres:19-alpine -rf /var/lib/postgresql/19
   ```

3. Change the `postgres` service image back to `postgres:18-alpine` and start the
   installation. Writes made after the upgrade are lost.
