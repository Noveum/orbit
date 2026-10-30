ALTER TABLE "mcp_grant" ADD COLUMN "identity_kind" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "agent_identity_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD COLUMN "owner_member_id" text;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "mcp_grant_id" text;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_grant_legacy_unique" ON "mcp_grant" USING btree ("client_id","user_id") WHERE "mcp_grant"."identity_kind" = 'legacy';