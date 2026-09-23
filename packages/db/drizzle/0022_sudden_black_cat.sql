ALTER TABLE "cycle_issue_membership" ADD COLUMN IF NOT EXISTS "assignee_agent_id_at_add" text;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD COLUMN IF NOT EXISTS "assignee_agent_id_at_close" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cycle_issue_membership'::regclass
      AND conname = left('cycle_issue_membership_assignee_agent_id_at_add_agent_identity_id_fk', 63)
  ) THEN
    ALTER TABLE "cycle_issue_membership"
      ADD CONSTRAINT "cycle_issue_membership_assignee_agent_id_at_add_agent_identity_id_fk"
      FOREIGN KEY ("assignee_agent_id_at_add") REFERENCES "public"."agent_identity"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cycle_issue_outcome'::regclass
      AND conname = left('cycle_issue_outcome_assignee_agent_id_at_close_agent_identity_id_fk', 63)
  ) THEN
    ALTER TABLE "cycle_issue_outcome"
      ADD CONSTRAINT "cycle_issue_outcome_assignee_agent_id_at_close_agent_identity_id_fk"
      FOREIGN KEY ("assignee_agent_id_at_close") REFERENCES "public"."agent_identity"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_activity_assignee_attribution_idx"
  ON "issue_activity" USING btree ("organization_id", "issue_id", "created_at")
  WHERE "issue_activity"."field" in ('assigneeId', 'assignee');--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN IF NOT EXISTS "mcp_grant_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.oauth_access_token'::regclass
      AND conname = 'oauth_access_token_mcp_grant_id_mcp_grant_id_fk'
  ) THEN
    ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_mcp_grant_id_mcp_grant_id_fk"
      FOREIGN KEY ("mcp_grant_id") REFERENCES "public"."mcp_grant"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_access_token_mcp_grant_idx"
  ON "oauth_access_token" USING btree ("mcp_grant_id");--> statement-breakpoint
UPDATE "mcp_grant"
SET "revoked_at" = coalesce("revoked_at", now()), "revoke_reason" = 'agent_identity_required'
WHERE "agent_identity_id" IS NULL
  AND "revoke_reason" IS DISTINCT FROM 'agent_identity_required';--> statement-breakpoint
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
$$;--> statement-breakpoint
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
  );--> statement-breakpoint
DELETE FROM "oauth_access_token" token_row
WHERE token_row."mcp_grant_id" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "mcp_grant" grant_row
     WHERE grant_row."id" = token_row."mcp_grant_id"
       AND grant_row."revoked_at" IS NULL
       AND grant_row."agent_identity_id" IS NOT NULL
   );--> statement-breakpoint
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
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mcp_grant'::regclass
      AND conname = 'mcp_grant_active_binding_check'
  ) THEN
    ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_active_binding_check"
      CHECK (("mcp_grant"."revoked_at" is null and "mcp_grant"."agent_identity_id" is not null and "mcp_grant"."user_id" is not null) or ("mcp_grant"."revoked_at" is not null and ("mcp_grant"."agent_identity_id" is not null or ("mcp_grant"."revoke_reason" is not null and "mcp_grant"."revoke_reason" = 'agent_identity_required'))));
  END IF;
END;
$$;--> statement-breakpoint
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
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."avatar" IS DISTINCT FROM OLD."avatar"
    OR NEW."owner_name_snapshot" IS DISTINCT FROM OLD."owner_name_snapshot"
    OR NEW."client_name_snapshot" IS DISTINCT FROM OLD."client_name_snapshot"
  ) THEN
    RAISE EXCEPTION 'deleted agent identity is immutable';
  END IF;
  IF OLD."deleted_at" IS NULL AND NEW."owner_user_id" IS NULL THEN
    RAISE EXCEPTION 'active agent identity requires an owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
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
$$ LANGUAGE plpgsql;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
