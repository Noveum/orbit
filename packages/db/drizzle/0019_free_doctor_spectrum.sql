CREATE TABLE "notification_source_event" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "source_event_key" text NOT NULL,
  "source_delivery_id" text,
  "subject_type" text NOT NULL,
  "subject_key" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ingestion_seq" bigint DEFAULT nextval('sync_id_seq') NOT NULL,
  "payload" jsonb,
  "fanout_completed_at" timestamp with time zone,
  "pruned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ALTER COLUMN "notification_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "source_event_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "manual_unread_anchor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "source_event_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "destination_kind" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "destination_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "integration_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_payload" jsonb;--> statement-breakpoint
ALTER TABLE "notification_source_event" ADD CONSTRAINT "notification_source_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_event_org_key_unique" ON "notification_source_event" USING btree ("organization_id","source_event_key");--> statement-breakpoint
CREATE INDEX "notification_source_event_delivery_idx" ON "notification_source_event" USING btree ("source_delivery_id") WHERE "notification_source_event"."source_delivery_id" is not null;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_source_event_id_notification_source_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."notification_source_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_source_event_id_notification_source_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."notification_source_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_user_unique" ON "notification" USING btree ("source_event_id","user_id") WHERE "notification"."source_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_source_destination_unique" ON "notification_delivery" USING btree ("organization_id","source_event_id","channel","destination_kind","destination_id") WHERE "notification_delivery"."source_event_id" is not null;