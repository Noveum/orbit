ALTER TABLE "audit_log" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "actor_avatar" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "principal_avatar" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "cause" text;--> statement-breakpoint
ALTER TABLE "issue_activity" ADD COLUMN "cause_actor_id" text;