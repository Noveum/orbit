-- Brings a database up to the doc schema the docs tree work introduced.
-- The tree ordering change shipped a backfill (doc-tree-order-catchup.sql) but never
-- the DDL the backfill assumes, so a database that predates it is missing
-- doc.sort_order and every read of a doc fails with 42703 column "sort_order" does not exist.
--
-- Adds, all on the doc area only:
--   doc.slug, doc.sort_order, doc.search_vector and the indexes over them
--   doc_collection.position and the org index that orders by it
--   doc_access_request, the table behind asking an owner for access
--   the two notification reasons an access request raises
--
-- Run doc-tree-order-catchup.sql afterwards to give existing docs a real order.
--
-- Safe to run more than once: every statement checks first, and the DDL is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/doc-tree-schema-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.

alter type public.notification_reason add value if not exists 'access_requested' before 'manual';
alter type public.notification_reason add value if not exists 'access_granted' before 'manual';

begin;

alter table public.doc add column if not exists slug text default '' not null;
alter table public.doc add column if not exists sort_order double precision default 0 not null;

alter table public.doc_collection add column if not exists position double precision default 0 not null;

do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.doc'::regclass and attname = 'search_vector' and not attisdropped
  ) then
    alter table public.doc add column search_vector tsvector
      generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', left(coalesce(content, ''), 200000)), 'B')
      ) stored;
  end if;
end $$;

create table if not exists public.doc_access_request (
  id text primary key,
  organization_id text not null,
  doc_id text not null,
  requester_id text not null,
  message text,
  status text default 'pending' not null,
  decided_by_id text,
  decided_at timestamptz,
  sync_id bigint default 0 not null,
  created_at timestamptz default now() not null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_request_organization_id_organization_id_fk'
      and conrelid = 'public.doc_access_request'::regclass
  ) then
    alter table public.doc_access_request add constraint doc_access_request_organization_id_organization_id_fk
      foreign key (organization_id) references public.organization(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_request_doc_id_doc_id_fk'
      and conrelid = 'public.doc_access_request'::regclass
  ) then
    alter table public.doc_access_request add constraint doc_access_request_doc_id_doc_id_fk
      foreign key (doc_id) references public.doc(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_request_requester_id_user_id_fk'
      and conrelid = 'public.doc_access_request'::regclass
  ) then
    alter table public.doc_access_request add constraint doc_access_request_requester_id_user_id_fk
      foreign key (requester_id) references public."user"(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_request_decided_by_id_user_id_fk'
      and conrelid = 'public.doc_access_request'::regclass
  ) then
    alter table public.doc_access_request add constraint doc_access_request_decided_by_id_user_id_fk
      foreign key (decided_by_id) references public."user"(id) on delete set null;
  end if;
end $$;

create unique index if not exists doc_access_request_pending_unique
  on public.doc_access_request (doc_id, requester_id) where status = 'pending';
create index if not exists doc_access_request_doc_idx
  on public.doc_access_request (doc_id, created_at);
create index if not exists doc_access_request_requester_idx
  on public.doc_access_request (requester_id);

create index if not exists doc_collection_order_idx on public.doc (collection_id, sort_order);
create index if not exists doc_search_idx on public.doc using gin (search_vector);

drop index if exists public.doc_collection_org_idx;
create index if not exists doc_collection_org_idx on public.doc_collection (organization_id, position);

commit;
