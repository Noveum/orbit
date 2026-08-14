alter table "webhook_delivery" add column if not exists "claimed_at" timestamp with time zone not null default now();
alter table "github_pull_request" add column if not exists "history_refresh_claimed_at" timestamp with time zone;
alter table "github_repository_sync" add column if not exists "pull_requests_backfilled_at" timestamp with time zone;
