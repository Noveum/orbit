DROP INDEX "notification_delivery_source_destination_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_source_destination_unique" ON "notification_delivery" USING btree ("organization_id","source_event_id","channel",coalesce("integration_id", ''),coalesce("slack_team_id", ''),coalesce("slack_app_id", ''),"destination_kind","destination_id") WHERE "notification_delivery"."source_event_id" is not null and "notification_delivery"."deduplicated_into_delivery_id" is null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_notification_deduplicated_target() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_row notification%ROWTYPE;
  target_row notification%ROWTYPE;
  inbound_id text;
BEGIN
  SELECT * INTO current_row FROM notification WHERE id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF current_row.deduplicated_into_notification_id IS NOT NULL THEN
    SELECT * INTO target_row FROM notification
    WHERE id = current_row.deduplicated_into_notification_id FOR UPDATE;
    IF NOT FOUND OR target_row.source_event_id IS NULL
      OR target_row.deduplicated_into_notification_id IS NOT NULL
      OR target_row.organization_id IS DISTINCT FROM current_row.organization_id
      OR target_row.user_id IS DISTINCT FROM current_row.user_id
    THEN
      RAISE EXCEPTION 'notification audit duplicate target must be a tenant-safe canonical survivor' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF current_row.source_event_id IS NULL
    OR current_row.deduplicated_into_notification_id IS NOT NULL
    OR (TG_OP = 'UPDATE' AND OLD.source_event_id IS NOT NULL AND OLD.source_event_id IS DISTINCT FROM current_row.source_event_id)
  THEN
    SELECT id INTO inbound_id FROM notification
    WHERE deduplicated_into_notification_id = current_row.id ORDER BY id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'notification survivor cannot be demoted while audit duplicates reference it' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_notification_delivery_deduplicated_target() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_row notification_delivery%ROWTYPE;
  target_row notification_delivery%ROWTYPE;
  inbound_id text;
BEGIN
  SELECT * INTO current_row FROM notification_delivery WHERE id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF current_row.deduplicated_into_delivery_id IS NOT NULL THEN
    SELECT * INTO target_row FROM notification_delivery
    WHERE id = current_row.deduplicated_into_delivery_id FOR UPDATE;
    IF NOT FOUND OR target_row.source_event_id IS NULL
      OR target_row.deduplicated_into_delivery_id IS NOT NULL
      OR target_row.organization_id IS DISTINCT FROM current_row.organization_id
      OR target_row.channel IS DISTINCT FROM current_row.channel
    THEN
      RAISE EXCEPTION 'notification delivery audit target must be a tenant-safe canonical survivor' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF current_row.source_event_id IS NULL
    OR current_row.deduplicated_into_delivery_id IS NOT NULL
    OR (TG_OP = 'UPDATE' AND OLD.source_event_id IS NOT NULL AND OLD.source_event_id IS DISTINCT FROM current_row.source_event_id)
  THEN
    SELECT id INTO inbound_id FROM notification_delivery
    WHERE deduplicated_into_delivery_id = current_row.id ORDER BY id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'notification delivery survivor cannot be demoted while audit rows reference it' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
