CREATE TABLE IF NOT EXISTS "agent_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text,
	"owner_name_snapshot" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name_snapshot" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"owner_disabled_at" timestamp with time zone,
	"admin_disabled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	"last_acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identity_owner_deleted_check" CHECK ("agent_identity"."owner_user_id" is not null or "agent_identity"."deleted_at" is not null)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_identity'::regclass
      AND conname = 'agent_identity_owner_deleted_check'
  ) THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_deleted_check"
      CHECK ("agent_identity"."owner_user_id" is not null or "agent_identity"."deleted_at" is not null);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class source ON source.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    WHERE namespace.nspname = 'public'
      AND source.relname = 'mcp_grant'
      AND constraint_row.conname = 'mcp_grant_user_id_user_id_fk'
      AND constraint_row.confdeltype <> 'n'
  ) THEN
    ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_user_id_user_id_fk";
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_rel ON index_rel.oid = index_row.indexrelid
    JOIN pg_class table_rel ON table_rel.oid = index_row.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_rel.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_rel.relname = 'mcp_grant'
      AND index_rel.relname = 'mcp_grant_client_user_unique'
  ) THEN
    DROP INDEX "mcp_grant_client_user_unique";
  END IF;
END;
$$;

ALTER TABLE "mcp_grant" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "principal_user_id" text;

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "principal_name" text;

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "grant_id" text;

ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "principal_user_id" text;

ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "principal_name" text;

ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "grant_id" text;

ALTER TABLE "mcp_grant" ADD COLUMN IF NOT EXISTS "agent_identity_id" text;

ALTER TABLE "mcp_grant" ADD COLUMN IF NOT EXISTS "principal_name_snapshot" text;

ALTER TABLE "mcp_grant" ADD COLUMN IF NOT EXISTS "revoke_reason" text;

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "creator_user_id" text;

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "creator_agent_id" text;

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "assignee_user_id" text;

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "assignee_agent_id" text;

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "owner_user_id" text;

ALTER TABLE "issue_activity" ADD COLUMN IF NOT EXISTS "principal_user_id" text;

ALTER TABLE "issue_activity" ADD COLUMN IF NOT EXISTS "principal_name" text;

ALTER TABLE "issue_activity" ADD COLUMN IF NOT EXISTS "grant_id" text;

ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "mcp_grant_id" text;

DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "issue"
    SET creator_user_id = CASE
          WHEN creator_user_id IS NULL AND creator_agent_id IS NULL THEN creator_id
          ELSE creator_user_id
        END,
        assignee_user_id = CASE
          WHEN assignee_user_id IS NULL AND assignee_agent_id IS NULL THEN assignee_id
          ELSE assignee_user_id
        END,
        owner_user_id = coalesce(owner_user_id, assignee_id)
    WHERE id IN (
      SELECT id
      FROM "issue"
      WHERE (creator_user_id IS NULL AND creator_agent_id IS NULL AND creator_id IS NOT NULL)
         OR (assignee_user_id IS NULL AND assignee_agent_id IS NULL AND assignee_id IS NOT NULL)
         OR (owner_user_id IS NULL AND assignee_id IS NOT NULL)
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;

DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "issue_activity" SET principal_user_id = (select id from "user" where id = "issue_activity".actor_id), principal_name = coalesce(principal_name, actor_name)
    WHERE id IN (
      SELECT id
      FROM "issue_activity"
      WHERE actor_type = 'user'
        AND (
          principal_name IS NULL
          OR (principal_user_id IS NULL AND EXISTS (SELECT 1 FROM "user" WHERE id = "issue_activity".actor_id))
        )
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;

DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "audit_log" SET principal_user_id = (select id from "user" where id = "audit_log".actor_id), principal_name = coalesce(principal_name, actor_name)
    WHERE id IN (
      SELECT id
      FROM "audit_log"
      WHERE actor_type = 'user'
        AND (
          principal_name IS NULL
          OR (principal_user_id IS NULL AND EXISTS (SELECT 1 FROM "user" WHERE id = "audit_log".actor_id))
        )
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;

DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "notification" SET principal_user_id = (select id from "user" where id = "notification".actor_id), principal_name = coalesce(principal_name, actor_name)
    WHERE id IN (
      SELECT id
      FROM "notification"
      WHERE actor_type = 'user'
        AND (
          principal_name IS NULL
          OR (principal_user_id IS NULL AND EXISTS (SELECT 1 FROM "user" WHERE id = "notification".actor_id))
        )
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;

DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "mcp_grant" SET principal_name_snapshot = coalesce((select name from "user" where id = mcp_grant.user_id), 'Former member')
    WHERE id IN (
      SELECT id FROM "mcp_grant" WHERE principal_name_snapshot is null
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;

ALTER TABLE "mcp_grant" ALTER COLUMN "principal_name_snapshot" SET NOT NULL;

UPDATE "mcp_grant"
SET "revoked_at" = coalesce("revoked_at", now()), "revoke_reason" = 'agent_identity_required'
WHERE "agent_identity_id" IS NULL
  AND "revoke_reason" IS DISTINCT FROM 'agent_identity_required';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "mcp_grant" grant_row
    WHERE grant_row."agent_identity_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "agent_identity" identity_row
        WHERE identity_row."id" = grant_row."agent_identity_id"
      )
  ) THEN
    RAISE EXCEPTION 'mcp_grant references an unknown agent identity';
  END IF;
END;
$$;

UPDATE "mcp_grant" grant_row
SET "revoked_at" = now(), "revoke_reason" = 'agent_identity_inactive'
WHERE grant_row."revoked_at" IS NULL
  AND grant_row."agent_identity_id" IS NOT NULL
  AND (
    grant_row."user_id" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "agent_identity" identity_row
      WHERE identity_row."id" = grant_row."agent_identity_id"
        AND identity_row."organization_id" = grant_row."organization_id"
        AND identity_row."owner_user_id" = grant_row."user_id"
        AND identity_row."client_id" = grant_row."client_id"
        AND identity_row."deleted_at" IS NULL
        AND identity_row."owner_disabled_at" IS NULL
        AND identity_row."admin_disabled_at" IS NULL
    )
  );

DELETE FROM "oauth_access_token" token_row
WHERE token_row."mcp_grant_id" IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM "mcp_grant" grant_row
     WHERE grant_row."id" = token_row."mcp_grant_id"
       AND grant_row."revoked_at" IS NULL
       AND grant_row."agent_identity_id" IS NOT NULL
   );

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_organization_id_organization_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_owner_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_client_id_oauth_application_client_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_identity_organization_id_id_unique" ON "agent_identity" USING btree ("organization_id","id");

CREATE INDEX IF NOT EXISTS "agent_identity_org_owner_idx" ON "agent_identity" USING btree ("organization_id","owner_user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND conname = 'audit_log_principal_user_id_user_id_fk') THEN
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND conname = 'audit_log_grant_id_mcp_grant_id_fk') THEN
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification'::regclass AND conname = 'notification_principal_user_id_user_id_fk') THEN
    ALTER TABLE "notification" ADD CONSTRAINT "notification_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notification'::regclass AND conname = 'notification_grant_id_mcp_grant_id_fk') THEN
    ALTER TABLE "notification" ADD CONSTRAINT "notification_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_grant'::regclass AND conname = 'mcp_grant_agent_identity_id_agent_identity_id_fk') THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_grant'::regclass AND conname = 'mcp_grant_organization_agent_identity_fk') THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_organization_agent_identity_fk" FOREIGN KEY ("organization_id","agent_identity_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_grant'::regclass AND conname = 'mcp_grant_user_id_user_id_fk') THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_creator_user_id_user_id_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_creator_agent_id_agent_identity_id_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_agent_id_agent_identity_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_assignee_user_id_user_id_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_assignee_agent_id_agent_identity_id_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_agent_id_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_owner_user_id_user_id_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_organization_creator_agent_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_organization_creator_agent_fk" FOREIGN KEY ("organization_id","creator_agent_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_organization_assignee_agent_fk') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_organization_assignee_agent_fk" FOREIGN KEY ("organization_id","assignee_agent_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue_activity'::regclass AND conname = 'issue_activity_principal_user_id_user_id_fk') THEN
    ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue_activity'::regclass AND conname = 'issue_activity_grant_id_mcp_grant_id_fk') THEN
    ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

CREATE INDEX IF NOT EXISTS "mcp_grant_agent_identity_idx" ON "mcp_grant" USING btree ("agent_identity_id");

CREATE UNIQUE INDEX IF NOT EXISTS "mcp_grant_active_agent_unique" ON "mcp_grant" USING btree ("agent_identity_id") WHERE "mcp_grant"."revoked_at" is null and "mcp_grant"."agent_identity_id" is not null;

CREATE INDEX IF NOT EXISTS "issue_assignee_user_idx" ON "issue" USING btree ("assignee_user_id","updated_at");

CREATE INDEX IF NOT EXISTS "issue_assignee_agent_idx" ON "issue" USING btree ("assignee_agent_id","updated_at");

CREATE INDEX IF NOT EXISTS "issue_owner_user_idx" ON "issue" USING btree ("owner_user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_creator_actor_check') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_actor_check" CHECK (("issue"."creator_user_id" is not null and "issue"."creator_agent_id" is null) or ("issue"."creator_user_id" is null and "issue"."creator_agent_id" is not null));
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_assignee_actor_check') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_actor_check" CHECK ("issue"."assignee_user_id" is null or "issue"."assignee_agent_id" is null);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.issue'::regclass AND conname = 'issue_agent_assignee_owner_check') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_agent_assignee_owner_check" CHECK ("issue"."assignee_agent_id" is null or "issue"."owner_user_id" is not null);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.oauth_access_token'::regclass AND conname = 'oauth_access_token_mcp_grant_id_mcp_grant_id_fk') THEN
    ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_mcp_grant_id_mcp_grant_id_fk" FOREIGN KEY ("mcp_grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

CREATE INDEX IF NOT EXISTS "oauth_access_token_mcp_grant_idx" ON "oauth_access_token" USING btree ("mcp_grant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "agent_identity_grant_binding_unique" ON "agent_identity" USING btree ("organization_id","owner_user_id","client_id","id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_grant'::regclass AND conname = 'mcp_grant_agent_binding_fk') THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_binding_fk" FOREIGN KEY ("organization_id","user_id","client_id","agent_identity_id") REFERENCES "public"."agent_identity"("organization_id","owner_user_id","client_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END; $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class source ON source.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    WHERE namespace.nspname = 'public'
      AND source.relname = 'mcp_grant'
      AND constraint_row.conname = 'mcp_grant_client_id_oauth_application_client_id_fk'
      AND constraint_row.confdeltype <> 'r'
  ) THEN
    ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk";
  END IF;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_grant'::regclass AND conname = 'mcp_grant_client_id_oauth_application_client_id_fk') THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_disabled_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_disabled_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_resumed_at" timestamptz;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_resumed_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_resumed_at" timestamptz;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_resumed_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "connection_revoked_at" timestamptz;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "connection_revoked_by_user_id" text;

ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_disabled_actor_id_snapshot" text;
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_resumed_actor_id_snapshot" text;
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_disabled_actor_id_snapshot" text;
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_resumed_actor_id_snapshot" text;
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "connection_revoked_actor_id_snapshot" text;
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "deleted_actor_id_snapshot" text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_owner_disabled_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_disabled_by_user_id_user_id_fk" FOREIGN KEY ("owner_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_admin_disabled_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_disabled_by_user_id_user_id_fk" FOREIGN KEY ("admin_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_deleted_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_owner_resumed_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_resumed_by_user_id_user_id_fk" FOREIGN KEY ("owner_resumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_admin_resumed_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_resumed_by_user_id_user_id_fk" FOREIGN KEY ("admin_resumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_identity'::regclass AND conname = 'agent_identity_connection_revoked_by_user_id_user_id_fk') THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_connection_revoked_by_user_id_user_id_fk" FOREIGN KEY ("connection_revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END; $$;

UPDATE "agent_identity" SET
  "owner_disabled_actor_id_snapshot" = coalesce("owner_disabled_actor_id_snapshot", "owner_disabled_by_user_id"),
  "owner_resumed_actor_id_snapshot" = coalesce("owner_resumed_actor_id_snapshot", "owner_resumed_by_user_id"),
  "admin_disabled_actor_id_snapshot" = coalesce("admin_disabled_actor_id_snapshot", "admin_disabled_by_user_id"),
  "admin_resumed_actor_id_snapshot" = coalesce("admin_resumed_actor_id_snapshot", "admin_resumed_by_user_id"),
  "connection_revoked_actor_id_snapshot" = coalesce("connection_revoked_actor_id_snapshot", "connection_revoked_by_user_id"),
  "deleted_actor_id_snapshot" = coalesce("deleted_actor_id_snapshot", "deleted_by_user_id")
WHERE "owner_disabled_actor_id_snapshot" IS NULL
   OR "owner_resumed_actor_id_snapshot" IS NULL
   OR "admin_disabled_actor_id_snapshot" IS NULL
   OR "admin_resumed_actor_id_snapshot" IS NULL
   OR "connection_revoked_actor_id_snapshot" IS NULL
   OR "deleted_actor_id_snapshot" IS NULL;

CREATE OR REPLACE FUNCTION "agent_identity_lifecycle_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."client_id" IS DISTINCT FROM OLD."client_id"
    OR (NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" AND NOT (
      OLD."deleted_at" IS NOT NULL AND NEW."owner_user_id" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = OLD."owner_user_id")
    )) THEN
    RAISE EXCEPTION 'agent identity binding is immutable';
  END IF;
  IF OLD."deleted_at" IS NOT NULL AND (
    NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
    OR NEW."deleted_reason" IS DISTINCT FROM OLD."deleted_reason"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."last_acted_at" IS DISTINCT FROM OLD."last_acted_at"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."avatar" IS DISTINCT FROM OLD."avatar"
    OR NEW."owner_name_snapshot" IS DISTINCT FROM OLD."owner_name_snapshot"
    OR NEW."client_name_snapshot" IS DISTINCT FROM OLD."client_name_snapshot"
    OR NEW."owner_disabled_actor_id_snapshot" IS DISTINCT FROM OLD."owner_disabled_actor_id_snapshot"
    OR NEW."owner_resumed_actor_id_snapshot" IS DISTINCT FROM OLD."owner_resumed_actor_id_snapshot"
    OR NEW."admin_disabled_actor_id_snapshot" IS DISTINCT FROM OLD."admin_disabled_actor_id_snapshot"
    OR NEW."admin_resumed_actor_id_snapshot" IS DISTINCT FROM OLD."admin_resumed_actor_id_snapshot"
    OR NEW."connection_revoked_actor_id_snapshot" IS DISTINCT FROM OLD."connection_revoked_actor_id_snapshot"
    OR NEW."deleted_actor_id_snapshot" IS DISTINCT FROM OLD."deleted_actor_id_snapshot"
  ) THEN
    RAISE EXCEPTION 'deleted agent identity is immutable';
  END IF;
  IF OLD."deleted_at" IS NULL AND NEW."owner_user_id" IS NULL THEN
    RAISE EXCEPTION 'active agent identity requires an owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.agent_identity'::regclass AND tgname = 'agent_identity_lifecycle_guard_trigger' AND NOT tgisinternal) THEN
    CREATE TRIGGER "agent_identity_lifecycle_guard_trigger"
    BEFORE UPDATE ON "agent_identity"
    FOR EACH ROW EXECUTE FUNCTION "agent_identity_lifecycle_guard"();
  END IF;
END; $$;

DO $$
DECLARE index_id oid;
BEGIN
  SELECT index_row.indexrelid
  INTO index_id
  FROM pg_index index_row
  JOIN pg_class index_rel ON index_rel.oid = index_row.indexrelid
  JOIN pg_class table_rel ON table_rel.oid = index_row.indrelid
  JOIN pg_namespace namespace ON namespace.oid = table_rel.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_rel.relname = 'issue_activity'
    AND index_rel.relname = 'issue_activity_assignee_attribution_idx';
  IF index_id IS NOT NULL AND pg_get_indexdef(index_id) NOT LIKE '%''assignee''%' THEN
    DROP INDEX "issue_activity_assignee_attribution_idx";
  END IF;
END;
$$;

ALTER TABLE "cycle_issue_membership" ADD COLUMN IF NOT EXISTS "assignee_agent_id_at_add" text;

ALTER TABLE "cycle_issue_outcome" ADD COLUMN IF NOT EXISTS "assignee_agent_id_at_close" text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cycle_issue_membership'::regclass AND conname = left('cycle_issue_membership_assignee_agent_id_at_add_agent_identity_id_fk', 63)) THEN
    ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_assignee_agent_id_at_add_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id_at_add") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cycle_issue_outcome'::regclass AND conname = left('cycle_issue_outcome_assignee_agent_id_at_close_agent_identity_id_fk', 63)) THEN
    ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_assignee_agent_id_at_close_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id_at_close") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END; $$;

CREATE INDEX IF NOT EXISTS "issue_activity_assignee_attribution_idx" ON "issue_activity" USING btree ("organization_id","issue_id","created_at") WHERE "issue_activity"."field" in ('assigneeId', 'assignee');

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid)
  INTO definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.mcp_grant'::regclass
    AND constraint_row.conname = 'mcp_grant_active_binding_check';
  IF definition IS NOT NULL AND position('revoke_reason IS NOT NULL' IN definition) = 0 THEN
    ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_active_binding_check";
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.mcp_grant'::regclass
      AND constraint_row.conname = 'mcp_grant_active_binding_check'
  ) THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_active_binding_check" CHECK (("mcp_grant"."revoked_at" is null and "mcp_grant"."agent_identity_id" is not null and "mcp_grant"."user_id" is not null) or ("mcp_grant"."revoked_at" is not null and ("mcp_grant"."agent_identity_id" is not null or ("mcp_grant"."revoke_reason" is not null and "mcp_grant"."revoke_reason" = 'agent_identity_required'))));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "mcp_grant_lifecycle_guard"() RETURNS trigger AS $$
DECLARE identity_id text;
BEGIN
  IF TG_TABLE_NAME = 'agent_identity' THEN
    identity_id := NEW.id;
  ELSE
    identity_id := NEW.agent_identity_id;
  END IF;
  PERFORM 1 FROM agent_identity WHERE id = identity_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM mcp_grant g
    JOIN agent_identity a ON a.id = g.agent_identity_id
    WHERE a.id = identity_id AND g.revoked_at IS NULL
      AND (a.deleted_at IS NOT NULL OR a.owner_disabled_at IS NOT NULL OR a.admin_disabled_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'active grant requires an active identity' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.mcp_grant'::regclass AND tgname = 'mcp_grant_lifecycle_guard_trigger' AND NOT tgisinternal) THEN
    CREATE CONSTRAINT TRIGGER "mcp_grant_lifecycle_guard_trigger"
    AFTER INSERT OR UPDATE ON "mcp_grant"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "mcp_grant_lifecycle_guard"();
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.agent_identity'::regclass AND tgname = 'agent_identity_active_grant_guard_trigger' AND NOT tgisinternal) THEN
    CREATE CONSTRAINT TRIGGER "agent_identity_active_grant_guard_trigger"
    AFTER UPDATE ON "agent_identity"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "mcp_grant_lifecycle_guard"();
  END IF;
END; $$;
