CREATE TABLE "cycle_issue_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"issue_identifier" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"entry_kind" text NOT NULL,
	"estimate_at_add" integer,
	"assignee_id_at_add" text,
	"project_id_at_add" text,
	"milestone_id_at_add" text,
	"coverage" text DEFAULT 'captured' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_issue_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"issue_identifier" text NOT NULL,
	"planned" boolean DEFAULT false NOT NULL,
	"estimate_at_commitment" integer,
	"estimate_at_close" integer,
	"assignee_id_at_close" text,
	"project_id_at_close" text,
	"milestone_id_at_close" text,
	"outcome" text NOT NULL,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone NOT NULL,
	"rollover_cycle_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_progress_snapshot" ADD COLUMN "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_progress_snapshot" ADD COLUMN "is_final" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_assignee_id_at_add_user_id_fk" FOREIGN KEY ("assignee_id_at_add") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_project_id_at_add_project_id_fk" FOREIGN KEY ("project_id_at_add") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_membership" ADD CONSTRAINT "cycle_issue_membership_milestone_id_at_add_milestone_id_fk" FOREIGN KEY ("milestone_id_at_add") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_assignee_id_at_close_user_id_fk" FOREIGN KEY ("assignee_id_at_close") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_project_id_at_close_project_id_fk" FOREIGN KEY ("project_id_at_close") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_milestone_id_at_close_milestone_id_fk" FOREIGN KEY ("milestone_id_at_close") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_issue_outcome" ADD CONSTRAINT "cycle_issue_outcome_rollover_cycle_id_cycle_id_fk" FOREIGN KEY ("rollover_cycle_id") REFERENCES "public"."cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_issue_membership_cycle_added_idx" ON "cycle_issue_membership" USING btree ("cycle_id","added_at");--> statement-breakpoint
CREATE INDEX "cycle_issue_membership_cycle_removed_idx" ON "cycle_issue_membership" USING btree ("cycle_id","removed_at");--> statement-breakpoint
CREATE INDEX "cycle_issue_membership_issue_added_idx" ON "cycle_issue_membership" USING btree ("issue_id","added_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_issue_outcome_cycle_issue_unique" ON "cycle_issue_outcome" USING btree ("cycle_id","issue_id");--> statement-breakpoint
CREATE INDEX "cycle_issue_outcome_cycle_outcome_idx" ON "cycle_issue_outcome" USING btree ("cycle_id","outcome");