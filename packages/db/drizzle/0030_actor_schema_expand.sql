CREATE TABLE "agent_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text,
	"client_id" text,
	"name" text NOT NULL,
	"avatar" text,
	"deleted_at" timestamp with time zone,
	"owner_name_snapshot" text NOT NULL,
	"client_name_snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "creator_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "assignee_agent_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_identity_org_idx" ON "agent_identity" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_identity_owner_idx" ON "agent_identity" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_identity_client_idx" ON "agent_identity" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_creator_agent_id_agent_identity_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_agent_id_agent_identity_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_creator_agent_idx" ON "issue" USING btree ("creator_agent_id");--> statement-breakpoint
CREATE INDEX "issue_assignee_agent_idx" ON "issue" USING btree ("assignee_agent_id");--> statement-breakpoint
CREATE INDEX "issue_owner_user_idx" ON "issue" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE FUNCTION sync_issue_human_actors() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creator_user_id := NEW.creator_id;
    NEW.creator_agent_id := NULL;
    NEW.assignee_user_id := NEW.assignee_id;
    NEW.assignee_agent_id := NULL;
  ELSE
    IF NEW.creator_id IS DISTINCT FROM OLD.creator_id THEN
      NEW.creator_user_id := NEW.creator_id;
      NEW.creator_agent_id := NULL;
    END IF;
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      NEW.assignee_user_id := NEW.assignee_id;
      NEW.assignee_agent_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER issue_human_actor_compat_trigger
BEFORE INSERT OR UPDATE OF creator_id, assignee_id ON "issue"
FOR EACH ROW EXECUTE FUNCTION sync_issue_human_actors();
--> statement-breakpoint
UPDATE "issue"
SET creator_user_id = creator_id,
    assignee_user_id = assignee_id
WHERE creator_agent_id IS NULL
  AND assignee_agent_id IS NULL
  AND (creator_user_id IS DISTINCT FROM creator_id
    OR assignee_user_id IS DISTINCT FROM assignee_id);
