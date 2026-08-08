CREATE TABLE "web_vital" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"route" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"rating" text NOT NULL,
	"navigation_type" text DEFAULT '' NOT NULL,
	"interaction_type" text,
	"target" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_vital" ADD CONSTRAINT "web_vital_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_vital" ADD CONSTRAINT "web_vital_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_vital_org_metric_idx" ON "web_vital" USING btree ("organization_id","metric","created_at");--> statement-breakpoint
CREATE INDEX "web_vital_route_idx" ON "web_vital" USING btree ("organization_id","route","metric");