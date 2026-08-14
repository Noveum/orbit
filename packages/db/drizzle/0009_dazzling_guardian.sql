ALTER TABLE "github_pull_request" ADD COLUMN "history_refresh_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_repository_sync" ADD COLUMN "pull_requests_backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;