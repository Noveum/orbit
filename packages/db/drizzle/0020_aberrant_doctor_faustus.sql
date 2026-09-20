ALTER TABLE "mcp_grant" DROP CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_client_id_oauth_application_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_application"("client_id") ON DELETE restrict ON UPDATE no action;