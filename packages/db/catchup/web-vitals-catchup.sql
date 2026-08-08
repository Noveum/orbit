create table if not exists "web_vital" (
  "id" text primary key not null,
  "organization_id" text not null,
  "user_id" text not null,
  "route" text not null,
  "metric" text not null,
  "value" double precision not null,
  "rating" text not null,
  "navigation_type" text default '' not null,
  "interaction_type" text,
  "target" text,
  "created_at" timestamp with time zone default now() not null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'web_vital_organization_id_organization_id_fk'
  ) then
    alter table "web_vital"
      add constraint "web_vital_organization_id_organization_id_fk"
      foreign key ("organization_id") references "public"."organization"("id") on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'web_vital_user_id_user_id_fk'
  ) then
    alter table "web_vital"
      add constraint "web_vital_user_id_user_id_fk"
      foreign key ("user_id") references "public"."user"("id") on delete cascade;
  end if;
end $$;

create index if not exists "web_vital_org_metric_idx"
  on "web_vital" using btree ("organization_id", "metric", "created_at");

create index if not exists "web_vital_route_idx"
  on "web_vital" using btree ("organization_id", "route", "metric");
