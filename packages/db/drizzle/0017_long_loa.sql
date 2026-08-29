ALTER TABLE "slack_user_mapping" ADD COLUMN "slack_channel_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_delivery_source_unique" ON "notification_delivery" USING btree ("source_delivery_id","user_id","channel");
