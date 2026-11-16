DROP INDEX IF EXISTS "mcp_grant_client_user_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_grant_active_agent_unique" ON "mcp_grant" USING btree ("agent_identity_id") WHERE "mcp_grant"."identity_kind" = 'agent' and "mcp_grant"."revoked_at" is null;
