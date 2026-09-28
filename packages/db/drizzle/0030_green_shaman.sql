CREATE TABLE "issue_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"sync_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_owner" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text,
	"owner_name_snapshot" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name_snapshot" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"owner_disabled_at" timestamp with time zone,
	"owner_disabled_by_user_id" text,
	"owner_disabled_actor_id_snapshot" text,
	"owner_resumed_at" timestamp with time zone,
	"owner_resumed_by_user_id" text,
	"owner_resumed_actor_id_snapshot" text,
	"admin_disabled_at" timestamp with time zone,
	"admin_disabled_by_user_id" text,
	"admin_disabled_actor_id_snapshot" text,
	"admin_resumed_at" timestamp with time zone,
	"admin_resumed_by_user_id" text,
	"admin_resumed_actor_id_snapshot" text,
	"connection_revoked_at" timestamp with time zone,
	"connection_revoked_by_user_id" text,
	"connection_revoked_actor_id_snapshot" text,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"deleted_actor_id_snapshot" text,
	"deleted_reason" text,
	"sync_id" integer DEFAULT 0 NOT NULL,
	"last_acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identity_owner_deleted_check" CHECK ("agent_identity"."owner_user_id" is not null or "agent_identity"."deleted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "mcp_grant_client_user_unique";--> statement-breakpoint
DROP INDEX "issue_activity_assignee_attribution_idx";--> statement-breakpoint
ALTER TABLE "mcp_grant" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "creator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "agent_identity_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "principal_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "mcp_grant_id" text;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD COLUMN "assignee_agent_id_at_add" text;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD COLUMN "assignee_agent_id_at_close" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "cause" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "cause_actor_id" text;--> statement-breakpoint

--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "issue"
    SET
      "creator_user_id" = "creator_id",
      "assignee_user_id" = "assignee_id",
      "owner_user_id" = "assignee_id"
    WHERE id IN (
      SELECT id
      FROM "issue"
      WHERE "creator_user_id" IS DISTINCT FROM "creator_id"
        OR "assignee_user_id" IS DISTINCT FROM "assignee_id"
        OR "owner_user_id" IS DISTINCT FROM "assignee_id"
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "issue_activity"
    SET
      "principal_user_id" = (SELECT id FROM "user" WHERE id = "issue_activity"."actor_id"),
      "principal_name" = "actor_name"
    WHERE id IN (
      SELECT id
      FROM "issue_activity"
      WHERE "actor_type" = 'user'
        AND ("principal_name" IS DISTINCT FROM "actor_name"
          OR ("principal_user_id" IS DISTINCT FROM "actor_id"
            AND EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "issue_activity"."actor_id")))
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "audit_log"
    SET
      "principal_user_id" = (SELECT id FROM "user" WHERE id = "audit_log"."actor_id"),
      "principal_name" = "actor_name"
    WHERE id IN (
      SELECT id
      FROM "audit_log"
      WHERE "actor_type" = 'user'
        AND ("principal_name" IS DISTINCT FROM "actor_name"
          OR ("principal_user_id" IS DISTINCT FROM "actor_id"
            AND EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "audit_log"."actor_id")))
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "notification"
    SET
      "principal_user_id" = (SELECT id FROM "user" WHERE id = "notification"."actor_id"),
      "principal_name" = "actor_name"
    WHERE id IN (
      SELECT id
      FROM "notification"
      WHERE "actor_type" = 'user'
        AND ("principal_name" IS DISTINCT FROM "actor_name"
          OR ("principal_user_id" IS DISTINCT FROM "actor_id"
            AND EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "notification"."actor_id")))
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "mcp_grant"
    SET "principal_name_snapshot" = (SELECT coalesce("user"."name", 'Former member') FROM "user" WHERE "user"."id" = "mcp_grant"."user_id")
    WHERE id IN (
      SELECT grant_row.id
      FROM "mcp_grant" grant_row
      INNER JOIN "user" ON "user"."id" = grant_row."user_id"
      WHERE grant_row."principal_name_snapshot" IS NULL
      ORDER BY grant_row.id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE affected integer;
BEGIN
  LOOP
    UPDATE "mcp_grant"
    SET "principal_name_snapshot" = 'Former member'
    WHERE id IN (
      SELECT id
      FROM "mcp_grant"
      WHERE "principal_name_snapshot" IS NULL
      ORDER BY id LIMIT 1000
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "mcp_grant" ALTER COLUMN "principal_name_snapshot" SET NOT NULL;
--> statement-breakpoint
UPDATE "mcp_grant"
SET "revoked_at" = coalesce("revoked_at", now()), "revoke_reason" = 'agent_identity_required'
WHERE "agent_identity_id" IS NULL
  AND "revoke_reason" IS DISTINCT FROM 'agent_identity_required';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "mcp_grant" grant_row
    WHERE grant_row."agent_identity_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "agent_identity" identity_row
        WHERE identity_row."id" = grant_row."agent_identity_id"
      )
  ) THEN
    RAISE EXCEPTION 'mcp_grant references an unknown agent identity';
  END IF;
END;
$$;
--> statement-breakpoint
UPDATE "mcp_grant" grant_row
SET "revoked_at" = now(), "revoke_reason" = 'agent_identity_inactive'
WHERE grant_row."revoked_at" IS NULL
  AND grant_row."agent_identity_id" IS NOT NULL
  AND (
    grant_row."user_id" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "agent_identity" identity_row
      WHERE identity_row."id" = grant_row."agent_identity_id"
        AND identity_row."organization_id" = grant_row."organization_id"
        AND identity_row."owner_user_id" = grant_row."user_id"
        AND identity_row."client_id" = grant_row."client_id"
        AND identity_row."deleted_at" IS NULL
        AND identity_row."owner_disabled_at" IS NULL
        AND identity_row."admin_disabled_at" IS NULL
    )
  );
--> statement-breakpoint
DELETE FROM "oauth_access_token" token_row
WHERE token_row."mcp_grant_id" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "mcp_grant" grant_row
     WHERE grant_row."id" = token_row."mcp_grant_id"
       AND grant_row."revoked_at" IS NULL
       AND grant_row."agent_identity_id" IS NOT NULL
   );
--> statement-breakpoint
UPDATE "agent_identity" SET
  "owner_disabled_actor_id_snapshot" = "owner_disabled_by_user_id",
  "owner_resumed_actor_id_snapshot" = "owner_resumed_by_user_id",
  "admin_disabled_actor_id_snapshot" = "admin_disabled_by_user_id",
  "admin_resumed_actor_id_snapshot" = "admin_resumed_by_user_id",
  "connection_revoked_actor_id_snapshot" = "connection_revoked_by_user_id",
  "deleted_actor_id_snapshot" = "deleted_by_user_id";
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER "agent_identity_lifecycle_guard_trigger"
BEFORE UPDATE ON "agent_identity"
FOR EACH ROW EXECUTE FUNCTION "agent_identity_lifecycle_guard"();
--> statement-breakpoint
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
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.mcp_grant'::regclass
      AND tgname = 'mcp_grant_lifecycle_guard_trigger'
      AND NOT tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER "mcp_grant_lifecycle_guard_trigger"
    AFTER INSERT OR UPDATE ON "mcp_grant"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "mcp_grant_lifecycle_guard"();
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.agent_identity'::regclass
      AND tgname = 'agent_identity_active_grant_guard_trigger'
      AND NOT tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER "agent_identity_active_grant_guard_trigger"
    AFTER UPDATE ON "agent_identity"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "mcp_grant_lifecycle_guard"();
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "issue_outbox" ADD CONSTRAINT "issue_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_disabled_by_user_id_user_id_fk" FOREIGN KEY ("owner_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_resumed_by_user_id_user_id_fk" FOREIGN KEY ("owner_resumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_disabled_by_user_id_user_id_fk" FOREIGN KEY ("admin_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_resumed_by_user_id_user_id_fk" FOREIGN KEY ("admin_resumed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_connection_revoked_by_user_id_user_id_fk" FOREIGN KEY ("connection_revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_outbox_available_idx" ON "issue_outbox" USING btree ("available_at","id");--> statement-breakpoint
CREATE INDEX "issue_outbox_aggregate_sync_idx" ON "issue_outbox" USING btree ("aggregate_id","sync_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_idempotency_grant_tool_key_unique" ON "mcp_idempotency" USING btree ("grant_id","tool_name","idempotency_key");--> statement-breakpoint
CREATE INDEX "mcp_idempotency_expires_idx" ON "mcp_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_organization_id_id_unique" ON "agent_identity" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_grant_binding_unique" ON "agent_identity" USING btree ("organization_id","owner_user_id","client_id","id");--> statement-breakpoint
CREATE INDEX "agent_identity_org_owner_idx" ON "agent_identity" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_organization_agent_identity_fk" FOREIGN KEY ("organization_id","agent_identity_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_binding_fk" FOREIGN KEY ("organization_id","user_id","client_id","agent_identity_id") REFERENCES "public"."agent_identity"("organization_id","owner_user_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_mcp_grant_id_mcp_grant_id_fk" FOREIGN KEY ("mcp_grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_assignee_agent_id_at_add_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id_at_add") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_assignee_agent_id_at_close_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id_at_close") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_agent_id_agent_identity_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_agent_id_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_organization_creator_agent_fk" FOREIGN KEY ("organization_id","creator_agent_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_organization_assignee_agent_fk" FOREIGN KEY ("organization_id","assignee_agent_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD CONSTRAINT "issue_activity_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_grant_agent_identity_idx" ON "mcp_grant" USING btree ("agent_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_grant_active_agent_unique" ON "mcp_grant" USING btree ("agent_identity_id") WHERE "mcp_grant"."revoked_at" is null and "mcp_grant"."agent_identity_id" is not null;--> statement-breakpoint
CREATE INDEX "oauth_access_token_mcp_grant_idx" ON "oauth_access_token" USING btree ("mcp_grant_id");--> statement-breakpoint
CREATE INDEX "issue_assignee_user_idx" ON "issue" USING btree ("assignee_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "issue_assignee_agent_idx" ON "issue" USING btree ("assignee_agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "issue_owner_user_idx" ON "issue" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "issue_activity_assignee_attribution_idx" ON "issue_activity" USING btree ("organization_id","issue_id","created_at") WHERE "issue_activity"."field" = any (array['assigneeId', 'assignee']);--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_active_binding_check" CHECK (("mcp_grant"."revoked_at" is null and "mcp_grant"."agent_identity_id" is not null and "mcp_grant"."user_id" is not null) or ("mcp_grant"."revoked_at" is not null and ("mcp_grant"."agent_identity_id" is not null or ("mcp_grant"."revoke_reason" is not null and "mcp_grant"."revoke_reason" = 'agent_identity_required'))));--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_actor_check" CHECK (("issue"."creator_user_id" is not null and "issue"."creator_agent_id" is null) or ("issue"."creator_user_id" is null and "issue"."creator_agent_id" is not null));--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_actor_check" CHECK ("issue"."assignee_user_id" is null or "issue"."assignee_agent_id" is null);--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_agent_assignee_owner_check" CHECK ("issue"."assignee_agent_id" is null or "issue"."owner_user_id" is not null);
