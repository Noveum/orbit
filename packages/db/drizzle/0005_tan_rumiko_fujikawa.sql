ALTER TABLE "cycle" DROP CONSTRAINT "cycle_team_id_team_id_fk";
--> statement-breakpoint
DROP INDEX "cycle_team_number_unique";--> statement-breakpoint
DROP INDEX "cycle_team_dates_idx";--> statement-breakpoint
ALTER TABLE "cycle" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_org_number_unique" ON "cycle" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "cycle_org_dates_idx" ON "cycle" USING btree ("organization_id","starts_at");