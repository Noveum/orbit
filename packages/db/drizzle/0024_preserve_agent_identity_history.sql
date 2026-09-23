ALTER TABLE "agent_identity" ADD COLUMN "owner_disabled_actor_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "owner_resumed_actor_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "admin_disabled_actor_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "admin_resumed_actor_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "connection_revoked_actor_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "deleted_actor_id_snapshot" text;--> statement-breakpoint
UPDATE "agent_identity" SET
  "owner_disabled_actor_id_snapshot" = "owner_disabled_by_user_id",
  "owner_resumed_actor_id_snapshot" = "owner_resumed_by_user_id",
  "admin_disabled_actor_id_snapshot" = "admin_disabled_by_user_id",
  "admin_resumed_actor_id_snapshot" = "admin_resumed_by_user_id",
  "connection_revoked_actor_id_snapshot" = "connection_revoked_by_user_id",
  "deleted_actor_id_snapshot" = "deleted_by_user_id";--> statement-breakpoint
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
