CREATE TABLE "issue_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"sync_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_outbox" ADD CONSTRAINT "issue_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_outbox_available_idx" ON "issue_outbox" USING btree ("available_at","id");--> statement-breakpoint
CREATE INDEX "issue_outbox_aggregate_sync_idx" ON "issue_outbox" USING btree ("aggregate_id","sync_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_idempotency_grant_tool_key_unique" ON "mcp_idempotency" USING btree ("grant_id","tool_name","idempotency_key");--> statement-breakpoint
CREATE INDEX "mcp_idempotency_expires_idx" ON "mcp_idempotency" USING btree ("expires_at");