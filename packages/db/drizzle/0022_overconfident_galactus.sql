CREATE TABLE "slack_notification_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_app_id" text NOT NULL,
	"credential_generation" bigint DEFAULT 0 NOT NULL,
	"destination_kind" text NOT NULL,
	"destination_id" text NOT NULL,
	"conversation_key" text NOT NULL,
	"channel_id" text,
	"root_ts" text,
	"state" text DEFAULT 'creating' NOT NULL,
	"created_by_delivery_id" text,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"sync_id" bigint DEFAULT nextval('sync_id_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_notification_thread_destination_check" CHECK ("slack_notification_thread"."destination_kind" in ('user', 'shared_channel')),
	CONSTRAINT "slack_notification_thread_state_check" CHECK ("slack_notification_thread"."state" in ('creating', 'ready', 'blocked', 'ambiguous', 'archived')),
	CONSTRAINT "slack_notification_thread_ready_check" CHECK ("slack_notification_thread"."state" <> 'ready' or ("slack_notification_thread"."channel_id" is not null and "slack_notification_thread"."root_ts" is not null)),
	CONSTRAINT "slack_notification_thread_generation_check" CHECK ("slack_notification_thread"."credential_generation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_owner_shape_check";--> statement-breakpoint
ALTER TABLE "slack_notification_thread" ADD CONSTRAINT "slack_notification_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notification_thread" ADD CONSTRAINT "slack_notification_thread_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "public"."integration"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notification_thread" ADD CONSTRAINT "slack_notification_thread_org_delivery_fk" FOREIGN KEY ("organization_id","created_by_delivery_id") REFERENCES "public"."notification_delivery"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_notification_thread_namespace_unique" ON "slack_notification_thread" USING btree ("integration_id","slack_team_id","slack_app_id","destination_kind","destination_id","conversation_key");--> statement-breakpoint
CREATE INDEX "slack_notification_thread_state_idx" ON "slack_notification_thread" USING btree ("organization_id","state");--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_owner_shape_check" CHECK ((
        (
          "notification_delivery"."deduplicated_into_delivery_id" is not null
          and "notification_delivery"."organization_id" is not null
        )
        or
        (
          "notification_delivery"."deduplicated_into_delivery_id" is null
          and (
            (
              "notification_delivery"."source_event_id" is null
              and "notification_delivery"."notification_id" is not null
              and "notification_delivery"."user_id" is not null
            )
            or
            (
              "notification_delivery"."source_event_id" is not null
              and "notification_delivery"."organization_id" is not null
              and "notification_delivery"."destination_kind" is not null
              and "notification_delivery"."destination_id" is not null
              and (
                (
                  "notification_delivery"."destination_kind" = 'user'
                  and "notification_delivery"."channel" = 'slack_dm'
                  and "notification_delivery"."notification_id" is not null
                  and "notification_delivery"."user_id" is not null
                  and "notification_delivery"."integration_id" is not null
                )
                or
                (
                  "notification_delivery"."destination_kind" = 'user'
                  and "notification_delivery"."channel" = 'email'
                  and "notification_delivery"."notification_id" is not null
                  and "notification_delivery"."user_id" is not null
                )
                or
                (
                  "notification_delivery"."destination_kind" = 'shared_channel'
                  and "notification_delivery"."channel" = 'slack'
                  and "notification_delivery"."notification_id" is null
                  and "notification_delivery"."user_id" is null
                  and "notification_delivery"."integration_id" is not null
                  and "notification_delivery"."provider_payload" is not null
                )
              )
            )
          )
        )
      ));