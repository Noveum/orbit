ALTER TABLE "integration" ADD CONSTRAINT "integration_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_org_id_user_unique" UNIQUE("organization_id","id","user_id");--> statement-breakpoint
ALTER TABLE "notification_source_event" ADD CONSTRAINT "notification_source_event_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_org_source_event_fk" FOREIGN KEY ("organization_id","source_event_id") REFERENCES "public"."notification_source_event"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_org_source_event_fk" FOREIGN KEY ("organization_id","source_event_id") REFERENCES "public"."notification_source_event"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_org_notification_user_fk" FOREIGN KEY ("organization_id","notification_id","user_id") REFERENCES "public"."notification"("organization_id","id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "public"."integration"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_owner_shape_check" CHECK ((
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
              "notification_delivery"."destination_kind" = 'shared_channel'
              and "notification_delivery"."channel" = 'slack'
              and "notification_delivery"."notification_id" is null
              and "notification_delivery"."user_id" is null
              and "notification_delivery"."integration_id" is not null
              and "notification_delivery"."provider_payload" is not null
            )
          )
        )
      ));
