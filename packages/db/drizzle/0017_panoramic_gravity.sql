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
	"admin_disabled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	"last_acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identity_owner_deleted_check" CHECK ("agent_identity"."owner_user_id" is not null or "agent_identity"."deleted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "mcp_grant_client_user_unique";--> statement-breakpoint
ALTER TABLE "mcp_grant" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "grant_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "agent_identity_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "principal_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "grant_id" text;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
ALTER TABLE "mcp_grant" ALTER COLUMN "principal_name_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_organization_id_id_unique" ON "agent_identity" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "agent_identity_org_owner_idx" ON "agent_identity" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_organization_agent_identity_fk" FOREIGN KEY ("organization_id","agent_identity_id") REFERENCES "public"."agent_identity"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "issue_assignee_user_idx" ON "issue" USING btree ("assignee_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "issue_assignee_agent_idx" ON "issue" USING btree ("assignee_agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "issue_owner_user_idx" ON "issue" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_actor_check" CHECK (("issue"."creator_user_id" is not null and "issue"."creator_agent_id" is null) or ("issue"."creator_user_id" is null and "issue"."creator_agent_id" is not null));--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_actor_check" CHECK ("issue"."assignee_user_id" is null or "issue"."assignee_agent_id" is null);--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_agent_assignee_owner_check" CHECK ("issue"."assignee_agent_id" is null or "issue"."owner_user_id" is not null);
