CREATE TABLE "mcp_idempotency_key" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"params_hash" text NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_idempotency_key" ADD CONSTRAINT "mcp_idempotency_key_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_idempotency_key_grant_key_unique" ON "mcp_idempotency_key" USING btree ("grant_id","key");--> statement-breakpoint
CREATE INDEX "mcp_idempotency_key_grant_idx" ON "mcp_idempotency_key" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "mcp_idempotency_key_expires_idx" ON "mcp_idempotency_key" USING btree ("expires_at");