create table if not exists "github_pull_request" (
  "id" text primary key,
  "organization_id" text not null references "organization"("id") on delete cascade,
  "repository_sync_id" text not null references "github_repository_sync"("id") on delete cascade,
  "repository_id" text not null,
  "repository_name" text not null,
  "number" bigint not null,
  "node_id" text not null default '',
  "title" text not null default '',
  "body" text not null default '',
  "url" text not null,
  "head_ref" text not null default '',
  "head_sha" text not null default '',
  "base_ref" text not null default '',
  "state" text not null default 'open',
  "draft" boolean not null default false,
  "merged" boolean not null default false,
  "author_login" text not null default '',
  "author_id" text not null default '',
  "review_decision" text,
  "check_status" text not null default 'unknown',
  "github_created_at" timestamp with time zone,
  "github_updated_at" timestamp with time zone,
  "history_synced_at" timestamp with time zone,
  "last_event_at" timestamp with time zone not null default now(),
  "sync_id" bigint not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

alter table "github_pull_request" add column if not exists "history_synced_at" timestamp with time zone;

create table if not exists "github_pull_request_activity" (
  "id" text primary key,
  "organization_id" text not null references "organization"("id") on delete cascade,
  "pull_request_id" text not null references "github_pull_request"("id") on delete cascade,
  "external_id" text not null,
  "type" text not null,
  "action" text not null,
  "actor_login" text not null default '',
  "actor_id" text not null default '',
  "body" text not null default '',
  "url" text not null default '',
  "state" text not null default '',
  "path" text,
  "line" integer,
  "occurred_at" timestamp with time zone not null,
  "sync_id" bigint not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create unique index if not exists "github_pull_request_repository_number_unique" on "github_pull_request" ("repository_sync_id", "number");
create index if not exists "github_pull_request_org_updated_idx" on "github_pull_request" ("organization_id", "updated_at");
create index if not exists "github_pull_request_repository_identity_idx" on "github_pull_request" ("organization_id", "repository_id", "number");
create unique index if not exists "github_pull_request_activity_external_unique" on "github_pull_request_activity" ("pull_request_id", "external_id");
create index if not exists "github_pull_request_activity_timeline_idx" on "github_pull_request_activity" ("pull_request_id", "occurred_at");
create index if not exists "github_pull_request_activity_org_idx" on "github_pull_request_activity" ("organization_id");

alter table "git_link" add column if not exists "pull_request_id" text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'git_link_pull_request_id_github_pull_request_id_fk'
  ) then
    alter table "git_link" add constraint "git_link_pull_request_id_github_pull_request_id_fk" foreign key ("pull_request_id") references "github_pull_request"("id") on delete set null;
  end if;
end
$$;

create index if not exists "git_link_pull_request_idx" on "git_link" ("pull_request_id");
