ALTER TABLE "cycle" DROP CONSTRAINT IF EXISTS "cycle_team_id_team_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "cycle_team_number_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "cycle_team_dates_idx";--> statement-breakpoint
ALTER TABLE "cycle" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
WITH "ordered_cycles" AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id"
    ORDER BY "starts_at", "created_at", "id"
  ) AS "organization_number"
  FROM "cycle"
)
UPDATE "cycle"
SET "number" = "ordered_cycles"."organization_number"
FROM "ordered_cycles"
WHERE "cycle"."id" = "ordered_cycles"."id"
  AND "cycle"."number" IS DISTINCT FROM "ordered_cycles"."organization_number";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_org_number_unique" ON "cycle" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycle_org_dates_idx" ON "cycle" USING btree ("organization_id","starts_at");
