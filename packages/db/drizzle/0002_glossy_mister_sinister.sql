ALTER TABLE "attachment" ADD COLUMN "upload_expires_at" timestamp with time zone DEFAULT (now() + interval '900 seconds');
--> statement-breakpoint
UPDATE "attachment"
SET "upload_expires_at" = "created_at" + interval '900 seconds';
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_requested_at" timestamp with time zone;
