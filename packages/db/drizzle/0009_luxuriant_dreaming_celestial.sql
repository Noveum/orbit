CREATE TABLE "github_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_sync_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"repository_name" text NOT NULL,
	"number" bigint NOT NULL,
	"node_id" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"head_ref" text DEFAULT '' NOT NULL,
	"head_sha" text DEFAULT '' NOT NULL,
	"base_ref" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"author_login" text DEFAULT '' NOT NULL,
	"author_id" text DEFAULT '' NOT NULL,
	"review_decision" text,
	"check_status" text DEFAULT 'unknown' NOT NULL,
	"github_created_at" timestamp with time zone,
	"github_updated_at" timestamp with time zone,
	"history_synced_at" timestamp with time zone,
	"history_refresh_claimed_at" timestamp with time zone,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"actor_login" text DEFAULT '' NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"path" text,
	"line" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"sync_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "git_link" ADD COLUMN "pull_request_id" text;--> statement-breakpoint
ALTER TABLE "github_repository_sync" ADD COLUMN "pull_requests_backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_repository_sync_id_github_repository_sync_id_fk" FOREIGN KEY ("repository_sync_id") REFERENCES "public"."github_repository_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_activity" ADD CONSTRAINT "github_pull_request_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_activity" ADD CONSTRAINT "github_pull_request_activity_pull_request_id_github_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_repository_number_unique" ON "github_pull_request" USING btree ("repository_sync_id","number");--> statement-breakpoint
CREATE INDEX "github_pull_request_org_updated_idx" ON "github_pull_request" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "github_pull_request_repository_identity_idx" ON "github_pull_request" USING btree ("organization_id","repository_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_activity_external_unique" ON "github_pull_request_activity" USING btree ("pull_request_id","external_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_activity_timeline_idx" ON "github_pull_request_activity" USING btree ("pull_request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "github_pull_request_activity_org_idx" ON "github_pull_request_activity" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "git_link" ADD CONSTRAINT "git_link_pull_request_id_github_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_link_pull_request_idx" ON "git_link" USING btree ("pull_request_id");