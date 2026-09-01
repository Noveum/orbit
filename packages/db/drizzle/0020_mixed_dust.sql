CREATE TABLE "github_check_activity" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "head_sha" text NOT NULL,
  "source_kind" text NOT NULL,
  "context_key" text NOT NULL,
  "provider_object_id" text NOT NULL,
  "provider_run_id" text,
  "provider_updated_at" timestamp with time zone NOT NULL,
  "webhook_delivery_id" text,
  "reconciliation_fetch_id" text,
  "state" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_check_activity_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "github_check_activity_owner_id_unique" UNIQUE("organization_id","repository_sync_id","head_sha","id"),
  CONSTRAINT "github_check_activity_source_kind_check" CHECK ("github_check_activity"."source_kind" in ('check_run', 'commit_status')),
  CONSTRAINT "github_check_activity_provenance_check" CHECK (("github_check_activity"."webhook_delivery_id" is not null) <> ("github_check_activity"."reconciliation_fetch_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "github_check_head_context" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "head_sha" text NOT NULL,
  "context_key" text NOT NULL,
  "source_kind" text NOT NULL,
  "state" text NOT NULL,
  "provider_updated_at" timestamp with time zone NOT NULL,
  "latest_provider_object_id" text NOT NULL,
  "latest_provider_run_id" text,
  "active" boolean DEFAULT true NOT NULL,
  "context_version" bigint DEFAULT 0 NOT NULL,
  "latest_activity_id" text NOT NULL,
  "reconciliation_state" text DEFAULT 'resolved' NOT NULL,
  "reconciliation_attempts" integer DEFAULT 0 NOT NULL,
  "reconciliation_available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reconciliation_claim_token" text,
  "reconciliation_claimed_at" timestamp with time zone,
  "reconciliation_lease_expires_at" timestamp with time zone,
  "reconciliation_claimed_version" bigint,
  "reconciliation_claimed_head_generation" bigint,
  "last_reconciliation_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_check_head_context_owner_id_unique" UNIQUE("organization_id","repository_sync_id","head_sha","context_key","id"),
  CONSTRAINT "github_check_head_context_source_kind_check" CHECK ("github_check_head_context"."source_kind" in ('check_run', 'commit_status')),
  CONSTRAINT "github_check_head_context_reconciliation_state_check" CHECK ("github_check_head_context"."reconciliation_state" in ('resolved', 'unresolved', 'processing', 'failed', 'unavailable')),
  CONSTRAINT "github_check_head_context_versions_check" CHECK ("github_check_head_context"."context_version" >= 0 and "github_check_head_context"."reconciliation_attempts" >= 0),
  CONSTRAINT "github_check_head_context_claim_check" CHECK ((
        "github_check_head_context"."reconciliation_state" = 'processing'
        and "github_check_head_context"."reconciliation_claim_token" is not null
        and "github_check_head_context"."reconciliation_claimed_at" is not null
        and "github_check_head_context"."reconciliation_lease_expires_at" is not null
        and "github_check_head_context"."reconciliation_claimed_version" is not null
        and "github_check_head_context"."reconciliation_claimed_head_generation" is not null
      ) or (
        "github_check_head_context"."reconciliation_state" <> 'processing'
        and "github_check_head_context"."reconciliation_claim_token" is null
        and "github_check_head_context"."reconciliation_claimed_at" is null
        and "github_check_head_context"."reconciliation_lease_expires_at" is null
        and "github_check_head_context"."reconciliation_claimed_version" is null
        and "github_check_head_context"."reconciliation_claimed_head_generation" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "github_check_head_reconciliation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "head_sha" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "job_version" bigint DEFAULT 0 NOT NULL,
  "context_generation" bigint DEFAULT 0 NOT NULL,
  "trigger_kind" text NOT NULL,
  "trigger_identity" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settle_deadline" timestamp with time zone,
  "rerun_required" boolean DEFAULT false NOT NULL,
  "claim_token" text,
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "claimed_job_version" bigint,
  "claimed_context_generation" bigint,
  "accepted_fetch_attempt_id" text,
  "accepted_job_version" bigint,
  "accepted_context_generation" bigint,
  "latest_snapshot" jsonb,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_check_head_reconciliation_owner_id_unique" UNIQUE("organization_id","repository_sync_id","head_sha","id"),
  CONSTRAINT "github_check_head_reconciliation_head_unique" UNIQUE("organization_id","repository_sync_id","head_sha"),
  CONSTRAINT "github_check_head_reconciliation_status_check" CHECK ("github_check_head_reconciliation"."status" in ('pending', 'processing', 'completed', 'failed', 'unavailable')),
  CONSTRAINT "github_check_head_reconciliation_versions_check" CHECK ("github_check_head_reconciliation"."job_version" >= 0 and "github_check_head_reconciliation"."context_generation" >= 0 and "github_check_head_reconciliation"."attempts" >= 0),
  CONSTRAINT "github_check_head_reconciliation_claim_check" CHECK ((
        "github_check_head_reconciliation"."status" = 'processing'
        and "github_check_head_reconciliation"."claim_token" is not null
        and "github_check_head_reconciliation"."claimed_at" is not null
        and "github_check_head_reconciliation"."lease_expires_at" is not null
        and "github_check_head_reconciliation"."claimed_job_version" is not null
        and "github_check_head_reconciliation"."claimed_context_generation" is not null
      ) or (
        "github_check_head_reconciliation"."status" <> 'processing'
        and "github_check_head_reconciliation"."claim_token" is null
        and "github_check_head_reconciliation"."claimed_at" is null
        and "github_check_head_reconciliation"."lease_expires_at" is null
        and "github_check_head_reconciliation"."claimed_job_version" is null
        and "github_check_head_reconciliation"."claimed_context_generation" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "github_check_reconciliation_fetch" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "head_sha" text NOT NULL,
  "head_reconciliation_id" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "captured_job_version" bigint NOT NULL,
  "captured_context_generation" bigint NOT NULL,
  "claim_token" text NOT NULL,
  "disposition" text DEFAULT 'started' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "result_hash" text,
  "failure" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_check_reconciliation_fetch_owner_id_unique" UNIQUE("organization_id","repository_sync_id","head_sha","id"),
  CONSTRAINT "github_check_reconciliation_fetch_disposition_check" CHECK ("github_check_reconciliation_fetch"."disposition" in ('started', 'fetched', 'failed', 'accepted', 'invalidated', 'abandoned')),
  CONSTRAINT "github_check_reconciliation_fetch_versions_check" CHECK ("github_check_reconciliation_fetch"."attempt_number" > 0 and "github_check_reconciliation_fetch"."captured_job_version" >= 0 and "github_check_reconciliation_fetch"."captured_context_generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_check_context" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "pull_request_id" text NOT NULL,
  "head_context_id" text NOT NULL,
  "head_sha" text NOT NULL,
  "context_key" text NOT NULL,
  "captured_head_epoch" bigint NOT NULL,
  "projected_context_version" bigint NOT NULL,
  "projected_state" text NOT NULL,
  "latest_activity_id" text NOT NULL,
  "notification_source_event_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_pull_request_check_context_versions_check" CHECK ("github_pull_request_check_context"."captured_head_epoch" >= 0 and "github_pull_request_check_context"."projected_context_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_reconciliation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "repository_sync_id" text NOT NULL,
  "pull_request_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "job_version" bigint DEFAULT 0 NOT NULL,
  "captured_head_epoch" bigint NOT NULL,
  "conflicting_head_shas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "conflicting_provider_updated_at" timestamp with time zone NOT NULL,
  "trigger_identity" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "claim_token" text,
  "claimed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "claimed_job_version" bigint,
  "claimed_head_epoch" bigint,
  "resolved_head_sha" text,
  "resolved_provider_updated_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_pull_request_reconciliation_status_check" CHECK ("github_pull_request_reconciliation"."status" in ('pending', 'processing', 'completed', 'failed', 'unavailable')),
  CONSTRAINT "github_pull_request_reconciliation_versions_check" CHECK ("github_pull_request_reconciliation"."job_version" >= 0 and "github_pull_request_reconciliation"."captured_head_epoch" >= 0 and "github_pull_request_reconciliation"."attempts" >= 0),
  CONSTRAINT "github_pull_request_reconciliation_conflicts_check" CHECK (jsonb_typeof("github_pull_request_reconciliation"."conflicting_head_shas") = 'array'),
  CONSTRAINT "github_pull_request_reconciliation_claim_check" CHECK ((
        "github_pull_request_reconciliation"."status" = 'processing'
        and "github_pull_request_reconciliation"."claim_token" is not null
        and "github_pull_request_reconciliation"."claimed_at" is not null
        and "github_pull_request_reconciliation"."lease_expires_at" is not null
        and "github_pull_request_reconciliation"."claimed_job_version" is not null
        and "github_pull_request_reconciliation"."claimed_head_epoch" is not null
      ) or (
        "github_pull_request_reconciliation"."status" <> 'processing'
        and "github_pull_request_reconciliation"."claim_token" is null
        and "github_pull_request_reconciliation"."claimed_at" is null
        and "github_pull_request_reconciliation"."lease_expires_at" is null
        and "github_pull_request_reconciliation"."claimed_job_version" is null
        and "github_pull_request_reconciliation"."claimed_head_epoch" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_quarantine" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "organization_id" text,
  "scope_kind" text NOT NULL,
  "scope_key_hash" text NOT NULL,
  "payload_envelope" jsonb,
  "encryption_key_version" integer NOT NULL,
  "parser_schema_version" integer NOT NULL,
  "reason_code" text NOT NULL,
  "reason_path" text NOT NULL,
  "diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "disposition" text DEFAULT 'awaiting_resolution' NOT NULL,
  "replay_request_id" text,
  "replay_requested_by" text,
  "replay_requested_at" timestamp with time zone,
  "replay_claim_token" text,
  "replay_claimed_at" timestamp with time zone,
  "replay_lease_expires_at" timestamp with time zone,
  "replacement_delivery_id" text,
  "replayed_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "ciphertext_cleared_at" timestamp with time zone,
  "quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_delivery_quarantine_scope_kind_check" CHECK ("webhook_delivery_quarantine"."scope_kind" in ('organization', 'unresolved')),
  CONSTRAINT "webhook_delivery_quarantine_disposition_check" CHECK ("webhook_delivery_quarantine"."disposition" in ('awaiting_resolution', 'replay_pending', 'replayed', 'resolved', 'organization_deleted', 'expired')),
  CONSTRAINT "webhook_delivery_quarantine_versions_check" CHECK ("webhook_delivery_quarantine"."encryption_key_version" > 0 and "webhook_delivery_quarantine"."parser_schema_version" > 0),
  CONSTRAINT "webhook_delivery_quarantine_payload_retention_check" CHECK ("webhook_delivery_quarantine"."payload_envelope" is not null or "webhook_delivery_quarantine"."ciphertext_cleared_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_org_source_event_fk";
--> statement-breakpoint
ALTER TABLE "webhook_delivery" DROP CONSTRAINT "webhook_delivery_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD COLUMN "head_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD COLUMN "provider_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_pull_request_activity" ADD COLUMN "check_activity_id" text;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_org_repository_id_unique" UNIQUE("organization_id","repository_sync_id","id");--> statement-breakpoint
ALTER TABLE "github_repository_sync" ADD CONSTRAINT "github_repository_sync_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "github_check_activity" ADD CONSTRAINT "github_check_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_activity" ADD CONSTRAINT "github_check_activity_repository_fk" FOREIGN KEY ("organization_id","repository_sync_id") REFERENCES "public"."github_repository_sync"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_activity" ADD CONSTRAINT "github_check_activity_webhook_delivery_fk" FOREIGN KEY ("organization_id","webhook_delivery_id") REFERENCES "public"."webhook_delivery"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_activity" ADD CONSTRAINT "github_check_activity_fetch_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","reconciliation_fetch_id") REFERENCES "public"."github_check_reconciliation_fetch"("organization_id","repository_sync_id","head_sha","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_context" ADD CONSTRAINT "github_check_head_context_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_context" ADD CONSTRAINT "github_check_head_context_head_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha") REFERENCES "public"."github_check_head_reconciliation"("organization_id","repository_sync_id","head_sha") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_context" ADD CONSTRAINT "github_check_head_context_activity_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","latest_activity_id") REFERENCES "public"."github_check_activity"("organization_id","repository_sync_id","head_sha","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_reconciliation" ADD CONSTRAINT "github_check_head_reconciliation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_reconciliation" ADD CONSTRAINT "github_check_head_reconciliation_repository_fk" FOREIGN KEY ("organization_id","repository_sync_id") REFERENCES "public"."github_repository_sync"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_head_reconciliation" ADD CONSTRAINT "github_check_head_reconciliation_accepted_fetch_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","accepted_fetch_attempt_id") REFERENCES "public"."github_check_reconciliation_fetch"("organization_id","repository_sync_id","head_sha","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_reconciliation_fetch" ADD CONSTRAINT "github_check_reconciliation_fetch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_reconciliation_fetch" ADD CONSTRAINT "github_check_reconciliation_fetch_repository_fk" FOREIGN KEY ("organization_id","repository_sync_id") REFERENCES "public"."github_repository_sync"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_reconciliation_fetch" ADD CONSTRAINT "github_check_reconciliation_fetch_head_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","head_reconciliation_id") REFERENCES "public"."github_check_head_reconciliation"("organization_id","repository_sync_id","head_sha","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_check_context" ADD CONSTRAINT "github_pull_request_check_context_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_check_context" ADD CONSTRAINT "github_pull_request_check_context_pull_request_fk" FOREIGN KEY ("organization_id","repository_sync_id","pull_request_id") REFERENCES "public"."github_pull_request"("organization_id","repository_sync_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_check_context" ADD CONSTRAINT "github_pull_request_check_context_head_context_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","context_key","head_context_id") REFERENCES "public"."github_check_head_context"("organization_id","repository_sync_id","head_sha","context_key","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_check_context" ADD CONSTRAINT "github_pull_request_check_context_activity_fk" FOREIGN KEY ("organization_id","repository_sync_id","head_sha","latest_activity_id") REFERENCES "public"."github_check_activity"("organization_id","repository_sync_id","head_sha","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_check_context" ADD CONSTRAINT "github_pull_request_check_context_source_event_fk" FOREIGN KEY ("organization_id","notification_source_event_id") REFERENCES "public"."notification_source_event"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reconciliation" ADD CONSTRAINT "github_pull_request_reconciliation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reconciliation" ADD CONSTRAINT "github_pull_request_reconciliation_pull_request_fk" FOREIGN KEY ("organization_id","repository_sync_id","pull_request_id") REFERENCES "public"."github_pull_request"("organization_id","repository_sync_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_quarantine" ADD CONSTRAINT "webhook_delivery_quarantine_delivery_id_webhook_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_delivery"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_quarantine" ADD CONSTRAINT "webhook_delivery_quarantine_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_quarantine" ADD CONSTRAINT "webhook_delivery_quarantine_replacement_delivery_id_webhook_delivery_id_fk" FOREIGN KEY ("replacement_delivery_id") REFERENCES "public"."webhook_delivery"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_check_activity_webhook_unique" ON "github_check_activity" USING btree ("organization_id","repository_sync_id","webhook_delivery_id","source_kind","provider_object_id","provider_updated_at") WHERE "github_check_activity"."webhook_delivery_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "github_check_activity_fetch_unique" ON "github_check_activity" USING btree ("organization_id","repository_sync_id","reconciliation_fetch_id","source_kind","provider_object_id","provider_updated_at") WHERE "github_check_activity"."reconciliation_fetch_id" is not null;--> statement-breakpoint
CREATE INDEX "github_check_activity_head_idx" ON "github_check_activity" USING btree ("organization_id","repository_sync_id","head_sha","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_check_head_context_unique" ON "github_check_head_context" USING btree ("organization_id","repository_sync_id","head_sha","context_key");--> statement-breakpoint
CREATE INDEX "github_check_head_context_reconciliation_idx" ON "github_check_head_context" USING btree ("reconciliation_state","reconciliation_available_at");--> statement-breakpoint
CREATE INDEX "github_check_head_reconciliation_pending_idx" ON "github_check_head_reconciliation" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_check_reconciliation_fetch_attempt_unique" ON "github_check_reconciliation_fetch" USING btree ("head_reconciliation_id","captured_job_version","attempt_number");--> statement-breakpoint
CREATE INDEX "github_check_reconciliation_fetch_disposition_idx" ON "github_check_reconciliation_fetch" USING btree ("disposition","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_check_context_unique" ON "github_pull_request_check_context" USING btree ("organization_id","pull_request_id","captured_head_epoch","context_key");--> statement-breakpoint
CREATE INDEX "github_pull_request_check_context_current_idx" ON "github_pull_request_check_context" USING btree ("organization_id","pull_request_id","captured_head_epoch","head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_reconciliation_pull_unique" ON "github_pull_request_reconciliation" USING btree ("organization_id","pull_request_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_reconciliation_pending_idx" ON "github_pull_request_reconciliation" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_quarantine_replacement_unique" ON "webhook_delivery_quarantine" USING btree ("replacement_delivery_id") WHERE "webhook_delivery_quarantine"."replacement_delivery_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_quarantine_replay_request_unique" ON "webhook_delivery_quarantine" USING btree ("replay_request_id") WHERE "webhook_delivery_quarantine"."replay_request_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_delivery_quarantine_scope_idx" ON "webhook_delivery_quarantine" USING btree ("scope_kind","scope_key_hash","quarantined_at");--> statement-breakpoint
ALTER TABLE "github_pull_request_activity" ADD CONSTRAINT "github_pull_request_activity_org_check_activity_fk" FOREIGN KEY ("organization_id","check_activity_id") REFERENCES "public"."github_check_activity"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_org_source_event_fk" FOREIGN KEY ("organization_id","source_event_id") REFERENCES "public"."notification_source_event"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request" ADD CONSTRAINT "github_pull_request_head_epoch_check" CHECK ("github_pull_request"."head_epoch" >= 0);--> statement-breakpoint
INSERT INTO "github_check_head_reconciliation" (
  "id",
  "organization_id",
  "repository_sync_id",
  "head_sha",
  "status",
  "job_version",
  "context_generation",
  "trigger_kind",
  "trigger_identity",
  "attempts",
  "available_at",
  "rerun_required",
  "created_at",
  "updated_at"
)
SELECT
  'ghr_bootstrap_' || md5("organization_id" || ':' || "repository_sync_id" || ':' || "head_sha"),
  "organization_id",
  "repository_sync_id",
  "head_sha",
  'pending',
  1,
  0,
  'migration_bootstrap',
  '0020_mixed_dust',
  0,
  now(),
  false,
  now(),
  now()
FROM (
  SELECT "organization_id", "repository_sync_id", lower("head_sha") AS "head_sha"
  FROM "github_pull_request"
  WHERE "state" IN ('draft', 'open', 'approved', 'changes_requested')
    AND "merged" = false
    AND "head_sha" ~ '^[0-9A-Fa-f]{40}$'
  GROUP BY "organization_id", "repository_sync_id", lower("head_sha")
) "current_heads"
ON CONFLICT ("organization_id", "repository_sync_id", "head_sha") DO NOTHING;
