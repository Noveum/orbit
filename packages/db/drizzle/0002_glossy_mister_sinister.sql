ALTER TABLE "attachment" ADD COLUMN "upload_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "attachment"
SET "upload_expires_at" = "created_at" + interval '900 seconds';
