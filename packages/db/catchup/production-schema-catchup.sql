-- Brings a database created before the doc sharing work up to the current schema.
-- Adds two tables: doc_access and view_preference.
-- Nothing else in the schema changed, so no existing table or column is touched.
--
-- Safe to run more than once: every statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/production-schema-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

create table if not exists public.doc_access (
    id text NOT NULL,
    organization_id text NOT NULL,
    doc_id text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    level text DEFAULT 'read'::text NOT NULL,
    granted_by_id text,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.view_preference (
  id text primary key,
  organization_id text not null,
  user_id text not null,
  page text not null,
  scope text not null default '',
  layout text not null default 'list',
  display jsonb not null default '{}'::jsonb,
  sync_id bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists view_preference_unique
  on public.view_preference (user_id, organization_id, page, scope);

create index if not exists doc_access_subject_idx on public.doc_access USING btree (subject_type, subject_id);
create unique index if not exists doc_access_unique on public.doc_access USING btree (doc_id, subject_type, subject_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_pkey' and conrelid = 'public.doc_access'::regclass
  ) then
    alter table public.doc_access add constraint doc_access_pkey PRIMARY KEY (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_doc_id_doc_id_fk' and conrelid = 'public.doc_access'::regclass
  ) then
    alter table public.doc_access add constraint doc_access_doc_id_doc_id_fk FOREIGN KEY (doc_id) REFERENCES public.doc(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_granted_by_id_user_id_fk' and conrelid = 'public.doc_access'::regclass
  ) then
    alter table public.doc_access add constraint doc_access_granted_by_id_user_id_fk FOREIGN KEY (granted_by_id) REFERENCES public."user"(id) ON DELETE SET NULL;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'doc_access_organization_id_organization_id_fk' and conrelid = 'public.doc_access'::regclass
  ) then
    alter table public.doc_access add constraint doc_access_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'view_preference_organization_id_organization_id_fk'
      and conrelid = 'public.view_preference'::regclass
  ) then
    alter table public.view_preference add constraint view_preference_organization_id_organization_id_fk
      FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'view_preference_user_id_user_id_fk'
      and conrelid = 'public.view_preference'::regclass
  ) then
    alter table public.view_preference add constraint view_preference_user_id_user_id_fk
      FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
  end if;
end $$;

commit;
