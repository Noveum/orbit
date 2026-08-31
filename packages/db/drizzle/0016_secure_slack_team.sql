DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "integration"
    WHERE "integration"."provider" = 'slack'
      AND coalesce("integration"."config" ->> 'slackTeamId', nullif("integration"."external_id", 'default')) IS NOT NULL
    GROUP BY coalesce("integration"."config" ->> 'slackTeamId', nullif("integration"."external_id", 'default'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate legacy Slack team claims block unique ownership. Keep one integration for each Slack workspace, disconnect the others, then rerun the migration.';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "integration_provider_slack_team_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "integration_provider_slack_team_idx" ON "integration" USING btree (coalesce("config" ->> 'slackTeamId', nullif("external_id", 'default'))) WHERE "integration"."provider" = 'slack' and coalesce("integration"."config" ->> 'slackTeamId', nullif("integration"."external_id", 'default')) is not null;
