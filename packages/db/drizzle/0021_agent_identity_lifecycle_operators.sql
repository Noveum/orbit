ALTER TABLE "agent_identity" ADD COLUMN "owner_disabled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "admin_disabled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_disabled_by_user_id_user_id_fk" FOREIGN KEY ("owner_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_disabled_by_user_id_user_id_fk" FOREIGN KEY ("admin_disabled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "mcp_grant"
SET "revoked_at" = now(), "revoke_reason" = 'agent_identity_required'
WHERE "agent_identity_id" IS NULL AND "revoked_at" IS NULL;--> statement-breakpoint
DELETE FROM "oauth_access_token"
WHERE "mcp_grant_id" IS NULL
   OR "mcp_grant_id" IN (
     SELECT "id" FROM "mcp_grant" WHERE "agent_identity_id" IS NULL
   );
--> statement-breakpoint
CREATE FUNCTION "agent_identity_lifecycle_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."client_id" IS DISTINCT FROM OLD."client_id"
    OR (OLD."owner_user_id" IS NOT NULL AND NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id") THEN
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
CREATE TRIGGER "agent_identity_lifecycle_guard_trigger"
BEFORE UPDATE ON "agent_identity"
FOR EACH ROW EXECUTE FUNCTION "agent_identity_lifecycle_guard"();
