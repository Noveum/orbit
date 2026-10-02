DROP INDEX IF EXISTS "cycle_org_number_unique";
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
  AND "cycle"."number" IS DISTINCT FROM "ordered_cycles"."organization_number";
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_org_number_unique"
  ON "cycle" USING btree ("organization_id", "number");
