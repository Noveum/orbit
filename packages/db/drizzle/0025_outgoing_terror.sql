ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_owner_shape_check";--> statement-breakpoint
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
                  and ("notification_delivery"."integration_id" is not null or "notification_delivery"."status" = 'unavailable')
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