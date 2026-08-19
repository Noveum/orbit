CREATE TABLE "slack_user_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_display_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_user_mapping" ADD CONSTRAINT "slack_user_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_mapping" ADD CONSTRAINT "slack_user_mapping_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_mapping" ADD CONSTRAINT "slack_user_mapping_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_mapping_user_unique" ON "slack_user_mapping" USING btree ("integration_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_mapping_slack_user_unique" ON "slack_user_mapping" USING btree ("integration_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "slack_user_mapping_org_idx" ON "slack_user_mapping" USING btree ("organization_id");