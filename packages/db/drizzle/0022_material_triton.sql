CREATE TABLE "notification_conversation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_key" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "category" text NOT NULL,
  "latest_event_id" text,
  "latest_type" text,
  "latest_actor_name" text,
  "latest_title" text,
  "latest_body" text,
  "latest_url" text,
  "latest_external_url" text,
  "latest_occurred_at" timestamp with time zone,
  "event_count" integer DEFAULT 0 NOT NULL,
  "unread_event_count" integer DEFAULT 0 NOT NULL,
  "unread_mention_count" integer DEFAULT 0 NOT NULL,
  "manual_unread" boolean DEFAULT false NOT NULL,
  "last_mention_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "snoozed_until" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "access_hidden_at" timestamp with time zone,
  "access_generation" bigint DEFAULT 0 NOT NULL,
  "snooze_generation" bigint DEFAULT 0 NOT NULL,
  "last_activity_seq" bigint DEFAULT 0 NOT NULL,
  "last_activity_at" timestamp with time zone,
  "sync_id" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_conversation_org_id_user_unique" UNIQUE("organization_id","id","user_id"),
  CONSTRAINT "notification_conversation_category_check" CHECK ("notification_conversation"."category" in ('activity', 'status')),
  CONSTRAINT "notification_conversation_counts_check" CHECK ("notification_conversation"."event_count" >= 0
        and "notification_conversation"."unread_event_count" >= 0
        and "notification_conversation"."unread_mention_count" >= 0
        and "notification_conversation"."unread_event_count" <= "notification_conversation"."event_count"
        and "notification_conversation"."unread_mention_count" <= "notification_conversation"."unread_event_count"
        and ("notification_conversation"."manual_unread" is false or "notification_conversation"."unread_event_count" = 0)),
  CONSTRAINT "notification_conversation_generations_check" CHECK ("notification_conversation"."access_generation" >= 0
        and "notification_conversation"."snooze_generation" >= 0
        and "notification_conversation"."last_activity_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_conversation_backfill_progress" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "phase" text NOT NULL,
  "cursor" text,
  "high_water_mark" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "processed_rows" bigint DEFAULT 0 NOT NULL,
  "pass_number" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_conversation_backfill_status_check" CHECK ("notification_conversation_backfill_progress"."status" in ('pending', 'running', 'completed', 'failed')),
  CONSTRAINT "notification_conversation_backfill_progress_check" CHECK ("notification_conversation_backfill_progress"."processed_rows" >= 0 and "notification_conversation_backfill_progress"."pass_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_inbox_state" (
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "unread_activity_count" integer DEFAULT 0 NOT NULL,
  "unread_mention_count" integer DEFAULT 0 NOT NULL,
  "sync_id" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_inbox_state_org_user_pk" PRIMARY KEY("organization_id","user_id"),
  CONSTRAINT "notification_inbox_state_counts_check" CHECK ("notification_inbox_state"."unread_count" >= 0
        and "notification_inbox_state"."unread_activity_count" >= 0
        and "notification_inbox_state"."unread_mention_count" >= 0
        and "notification_inbox_state"."unread_activity_count" <= "notification_inbox_state"."unread_count"
        and "notification_inbox_state"."unread_mention_count" <= "notification_inbox_state"."unread_count")
);
--> statement-breakpoint
CREATE TABLE "notification_snooze_wake" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "snooze_generation" bigint NOT NULL,
  "wake_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "claim_token" text,
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_snooze_wake_status_check" CHECK ("notification_snooze_wake"."status" in ('pending', 'processing', 'completed', 'failed', 'unavailable')),
  CONSTRAINT "notification_snooze_wake_attempts_check" CHECK ("notification_snooze_wake"."snooze_generation" > 0 and "notification_snooze_wake"."attempts" >= 0),
  CONSTRAINT "notification_snooze_wake_claim_check" CHECK ((
        "notification_snooze_wake"."status" = 'processing'
        and "notification_snooze_wake"."claim_token" is not null
        and "notification_snooze_wake"."claimed_at" is not null
        and "notification_snooze_wake"."lease_expires_at" is not null
      ) or (
        "notification_snooze_wake"."status" <> 'processing'
        and "notification_snooze_wake"."claim_token" is null
        and "notification_snooze_wake"."claimed_at" is null
        and "notification_snooze_wake"."lease_expires_at" is null
      ))
);
--> statement-breakpoint
DROP INDEX "notification_delivery_source_destination_unique";--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_owner_shape_check";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "ingested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "ingestion_seq" bigint;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "surface_in_inbox" boolean;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "deduplicated_into_notification_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "conversation_key" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "deduplicated_into_delivery_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "slack_team_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "slack_app_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "credential_generation" bigint;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_request_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_payload_hash" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "provider_idempotency_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "send_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_conversation" ADD CONSTRAINT "notification_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_conversation" ADD CONSTRAINT "notification_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_conversation" ADD CONSTRAINT "notification_conversation_latest_event_fk" FOREIGN KEY ("organization_id","latest_event_id","user_id") REFERENCES "public"."notification"("organization_id","id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_conversation_backfill_progress" ADD CONSTRAINT "notification_conversation_backfill_progress_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox_state" ADD CONSTRAINT "notification_inbox_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox_state" ADD CONSTRAINT "notification_inbox_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_snooze_wake" ADD CONSTRAINT "notification_snooze_wake_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_snooze_wake" ADD CONSTRAINT "notification_snooze_wake_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_snooze_wake" ADD CONSTRAINT "notification_snooze_wake_conversation_fk" FOREIGN KEY ("organization_id","conversation_id","user_id") REFERENCES "public"."notification_conversation"("organization_id","id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_snooze_wake" ADD CONSTRAINT "notification_snooze_wake_inbox_state_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."notification_inbox_state"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_conversation_org_user_key_unique" ON "notification_conversation" USING btree ("organization_id","user_id","conversation_key");--> statement-breakpoint
CREATE INDEX "notification_conversation_list_idx" ON "notification_conversation" USING btree ("organization_id","user_id","category","last_activity_seq" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_conversation_unread_idx" ON "notification_conversation" USING btree ("organization_id","user_id","last_activity_seq" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification_conversation"."unread_event_count" > 0 or "notification_conversation"."manual_unread" is true;--> statement-breakpoint
CREATE INDEX "notification_conversation_mentions_idx" ON "notification_conversation" USING btree ("organization_id","user_id","last_activity_seq" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification_conversation"."last_mention_at" is not null;--> statement-breakpoint
CREATE INDEX "notification_conversation_pull_request_idx" ON "notification_conversation" USING btree ("organization_id","user_id","last_activity_seq" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification_conversation"."subject_type" = 'github_pull_request';--> statement-breakpoint
CREATE INDEX "notification_conversation_snooze_idx" ON "notification_conversation" USING btree ("organization_id","user_id","snoozed_until");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_conversation_backfill_org_phase_unique" ON "notification_conversation_backfill_progress" USING btree ("organization_id","phase");--> statement-breakpoint
CREATE INDEX "notification_conversation_backfill_status_idx" ON "notification_conversation_backfill_progress" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_snooze_wake_conversation_generation_unique" ON "notification_snooze_wake" USING btree ("organization_id","conversation_id","snooze_generation");--> statement-breakpoint
CREATE INDEX "notification_snooze_wake_due_idx" ON "notification_snooze_wake" USING btree ("status","wake_at");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_conversation_fk" FOREIGN KEY ("organization_id","conversation_id","user_id") REFERENCES "public"."notification_conversation"("organization_id","id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_deduplicated_into_fk" FOREIGN KEY ("organization_id","deduplicated_into_notification_id","user_id") REFERENCES "public"."notification"("organization_id","id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_deduplicated_into_fk" FOREIGN KEY ("organization_id","deduplicated_into_delivery_id") REFERENCES "public"."notification_delivery"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_conversation_events_idx" ON "notification" USING btree ("organization_id","user_id","conversation_id","ingestion_seq" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notification"."conversation_id" is not null and "notification"."deduplicated_into_notification_id" is null;--> statement-breakpoint
CREATE INDEX "notification_deduplicated_into_idx" ON "notification" USING btree ("organization_id","user_id","deduplicated_into_notification_id") WHERE "notification"."deduplicated_into_notification_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_slack_processing_unique" ON "notification_delivery" USING btree ("organization_id","channel","integration_id","slack_team_id","slack_app_id","destination_kind","destination_id","conversation_key") WHERE "notification_delivery"."status" = 'processing'
          and ("notification_delivery"."channel" = 'slack' or "notification_delivery"."channel" = 'slack_dm')
          and "notification_delivery"."deduplicated_into_delivery_id" is null;--> statement-breakpoint
CREATE INDEX "notification_delivery_deduplicated_into_idx" ON "notification_delivery" USING btree ("organization_id","deduplicated_into_delivery_id") WHERE "notification_delivery"."deduplicated_into_delivery_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_delivery_provider_request_idx" ON "notification_delivery" USING btree ("channel","provider_request_id") WHERE "notification_delivery"."provider_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_source_destination_unique" ON "notification_delivery" USING btree ("organization_id","source_event_id","channel","destination_kind","destination_id") WHERE "notification_delivery"."source_event_id" is not null and "notification_delivery"."deduplicated_into_delivery_id" is null;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_conversation_shape_check" CHECK ("notification"."conversation_id" is null or (
        "notification"."occurred_at" is not null
        and "notification"."ingested_at" is not null
        and "notification"."ingestion_seq" is not null
        and "notification"."surface_in_inbox" is not null
      ));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_ingestion_seq_check" CHECK ("notification"."ingestion_seq" is null or "notification"."ingestion_seq" > 0);--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_deduplicated_shape_check" CHECK ("notification"."deduplicated_into_notification_id" is null or (
        "notification"."source_event_id" is null
        and "notification"."surface_in_inbox" is false
        and "notification"."deduplicated_into_notification_id" <> "notification"."id"
      ));--> statement-breakpoint
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
      ));--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_deduplicated_shape_check" CHECK ("notification_delivery"."deduplicated_into_delivery_id" is null or (
        "notification_delivery"."organization_id" is not null
        and "notification_delivery"."source_event_id" is null
        and "notification_delivery"."deduplicated_into_delivery_id" <> "notification_delivery"."id"
        and "notification_delivery"."status" in ('delivered', 'unavailable', 'succeeded', 'skipped')
      ));--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_attempts_check" CHECK ("notification_delivery"."attempts" >= 0
        and ("notification_delivery"."credential_generation" is null or "notification_delivery"."credential_generation" >= 0));--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_provider_payload_check" CHECK ("notification_delivery"."provider_payload_hash" is null or "notification_delivery"."provider_payload" is not null);--> statement-breakpoint
CREATE FUNCTION validate_notification_deduplicated_target() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_source_event_id text;
  target_deduplicated_into_id text;
  target_organization_id text;
  target_user_id text;
  inbound_id text;
BEGIN
  IF NEW.deduplicated_into_notification_id IS NOT NULL THEN
    SELECT
      source_event_id,
      deduplicated_into_notification_id,
      organization_id,
      user_id
    INTO
      target_source_event_id,
      target_deduplicated_into_id,
      target_organization_id,
      target_user_id
    FROM notification
    WHERE id = NEW.deduplicated_into_notification_id
    FOR UPDATE;

    IF NOT FOUND
      OR target_source_event_id IS NULL
      OR target_deduplicated_into_id IS NOT NULL
      OR target_organization_id <> NEW.organization_id
      OR target_user_id <> NEW.user_id
    THEN
      RAISE EXCEPTION 'notification audit duplicate target must be a tenant-safe canonical survivor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.source_event_id IS NULL
    OR NEW.deduplicated_into_notification_id IS NOT NULL
    OR (
      TG_OP = 'UPDATE'
      AND OLD.source_event_id IS NOT NULL
      AND OLD.source_event_id IS DISTINCT FROM NEW.source_event_id
    )
  THEN
    SELECT id
    INTO inbound_id
    FROM notification
    WHERE deduplicated_into_notification_id = NEW.id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'notification survivor cannot be demoted while audit duplicates reference it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER notification_deduplicated_target_trigger
AFTER INSERT OR UPDATE ON notification
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_notification_deduplicated_target();--> statement-breakpoint
CREATE FUNCTION validate_notification_delivery_deduplicated_target() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_source_event_id text;
  target_deduplicated_into_id text;
  target_organization_id text;
  inbound_id text;
BEGIN
  IF NEW.deduplicated_into_delivery_id IS NOT NULL THEN
    SELECT source_event_id, deduplicated_into_delivery_id, organization_id
    INTO target_source_event_id, target_deduplicated_into_id, target_organization_id
    FROM notification_delivery
    WHERE id = NEW.deduplicated_into_delivery_id
    FOR UPDATE;

    IF NOT FOUND
      OR target_source_event_id IS NULL
      OR target_deduplicated_into_id IS NOT NULL
      OR target_organization_id IS DISTINCT FROM NEW.organization_id
    THEN
      RAISE EXCEPTION 'notification delivery audit target must be a tenant-safe canonical survivor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.source_event_id IS NULL
    OR NEW.deduplicated_into_delivery_id IS NOT NULL
    OR (
      TG_OP = 'UPDATE'
      AND OLD.source_event_id IS NOT NULL
      AND OLD.source_event_id IS DISTINCT FROM NEW.source_event_id
    )
  THEN
    SELECT id
    INTO inbound_id
    FROM notification_delivery
    WHERE deduplicated_into_delivery_id = NEW.id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'notification delivery survivor cannot be demoted while audit rows reference it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER notification_delivery_deduplicated_target_trigger
AFTER INSERT OR UPDATE ON notification_delivery
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_notification_delivery_deduplicated_target();
