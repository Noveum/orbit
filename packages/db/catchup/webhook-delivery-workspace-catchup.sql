alter table "webhook_delivery" add column if not exists "organization_id" text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'webhook_delivery_organization_id_organization_id_fk'
  ) then
    alter table "webhook_delivery"
      add constraint "webhook_delivery_organization_id_organization_id_fk"
      foreign key ("organization_id") references "public"."organization"("id") on delete cascade;
  end if;
end
$$;

create index if not exists "webhook_delivery_org_idx"
  on "webhook_delivery" using btree ("organization_id", "created_at");
