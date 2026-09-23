ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_resumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "owner_resumed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_resumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "admin_resumed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "connection_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD COLUMN IF NOT EXISTS "connection_revoked_by_user_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_identity'::regclass
      AND conname = 'agent_identity_owner_resumed_by_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_owner_resumed_by_user_id_user_id_fk"
      FOREIGN KEY ("owner_resumed_by_user_id") REFERENCES "public"."user"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_identity'::regclass
      AND conname = 'agent_identity_admin_resumed_by_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_admin_resumed_by_user_id_user_id_fk"
      FOREIGN KEY ("admin_resumed_by_user_id") REFERENCES "public"."user"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_identity'::regclass
      AND conname = 'agent_identity_connection_revoked_by_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_connection_revoked_by_user_id_user_id_fk"
      FOREIGN KEY ("connection_revoked_by_user_id") REFERENCES "public"."user"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END;
$$;
