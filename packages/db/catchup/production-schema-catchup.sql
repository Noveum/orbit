-- Brings a database created before the standup and doc sharing work up to the current schema.
-- Adds five tables: standup, standup_turn, standup_blocker, standup_rotation, doc_access.
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

create table if not exists public.standup (
    id text NOT NULL,
    organization_id text NOT NULL,
    team_id text NOT NULL,
    cycle_id text,
    held_on date NOT NULL,
    facilitator_id text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    current_turn_id text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.standup_blocker (
    id text NOT NULL,
    organization_id text NOT NULL,
    turn_id text NOT NULL,
    issue_id text,
    summary text NOT NULL,
    owner_id text,
    resolved_at timestamp with time zone,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.standup_rotation (
    id text NOT NULL,
    organization_id text NOT NULL,
    team_id text NOT NULL,
    user_id text NOT NULL,
    "position" integer NOT NULL,
    facilitates smallint DEFAULT 1 NOT NULL,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.standup_turn (
    id text NOT NULL,
    organization_id text NOT NULL,
    standup_id text NOT NULL,
    user_id text NOT NULL,
    "position" integer NOT NULL,
    attendance text DEFAULT 'unknown'::text NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    blockers text DEFAULT ''::text NOT NULL,
    spoke_at timestamp with time zone,
    duration_seconds integer,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

create index if not exists doc_access_subject_idx on public.doc_access USING btree (subject_type, subject_id);
create unique index if not exists doc_access_unique on public.doc_access USING btree (doc_id, subject_type, subject_id);
create index if not exists standup_blocker_issue_idx on public.standup_blocker USING btree (issue_id);
create index if not exists standup_blocker_turn_idx on public.standup_blocker USING btree (turn_id);
create index if not exists standup_cycle_idx on public.standup USING btree (cycle_id);
create index if not exists standup_org_day_idx on public.standup USING btree (organization_id, held_on);
create unique index if not exists standup_rotation_member_unique on public.standup_rotation USING btree (team_id, user_id);
create index if not exists standup_rotation_order_idx on public.standup_rotation USING btree (team_id, "position");
create unique index if not exists standup_team_day_unique on public.standup USING btree (team_id, held_on);
create index if not exists standup_turn_order_idx on public.standup_turn USING btree (standup_id, "position");
create unique index if not exists standup_turn_person_unique on public.standup_turn USING btree (standup_id, user_id);

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
    where conname = 'standup_blocker_pkey' and conrelid = 'public.standup_blocker'::regclass
  ) then
    alter table public.standup_blocker add constraint standup_blocker_pkey PRIMARY KEY (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_pkey' and conrelid = 'public.standup'::regclass
  ) then
    alter table public.standup add constraint standup_pkey PRIMARY KEY (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_rotation_pkey' and conrelid = 'public.standup_rotation'::regclass
  ) then
    alter table public.standup_rotation add constraint standup_rotation_pkey PRIMARY KEY (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_turn_pkey' and conrelid = 'public.standup_turn'::regclass
  ) then
    alter table public.standup_turn add constraint standup_turn_pkey PRIMARY KEY (id);
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
    where conname = 'standup_blocker_issue_id_issue_id_fk' and conrelid = 'public.standup_blocker'::regclass
  ) then
    alter table public.standup_blocker add constraint standup_blocker_issue_id_issue_id_fk FOREIGN KEY (issue_id) REFERENCES public.issue(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_blocker_organization_id_organization_id_fk' and conrelid = 'public.standup_blocker'::regclass
  ) then
    alter table public.standup_blocker add constraint standup_blocker_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_blocker_owner_id_user_id_fk' and conrelid = 'public.standup_blocker'::regclass
  ) then
    alter table public.standup_blocker add constraint standup_blocker_owner_id_user_id_fk FOREIGN KEY (owner_id) REFERENCES public."user"(id) ON DELETE SET NULL;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_blocker_turn_id_standup_turn_id_fk' and conrelid = 'public.standup_blocker'::regclass
  ) then
    alter table public.standup_blocker add constraint standup_blocker_turn_id_standup_turn_id_fk FOREIGN KEY (turn_id) REFERENCES public.standup_turn(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_cycle_id_cycle_id_fk' and conrelid = 'public.standup'::regclass
  ) then
    alter table public.standup add constraint standup_cycle_id_cycle_id_fk FOREIGN KEY (cycle_id) REFERENCES public.cycle(id) ON DELETE SET NULL;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_facilitator_id_user_id_fk' and conrelid = 'public.standup'::regclass
  ) then
    alter table public.standup add constraint standup_facilitator_id_user_id_fk FOREIGN KEY (facilitator_id) REFERENCES public."user"(id) ON DELETE SET NULL;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_organization_id_organization_id_fk' and conrelid = 'public.standup'::regclass
  ) then
    alter table public.standup add constraint standup_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_rotation_organization_id_organization_id_fk' and conrelid = 'public.standup_rotation'::regclass
  ) then
    alter table public.standup_rotation add constraint standup_rotation_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_rotation_team_id_team_id_fk' and conrelid = 'public.standup_rotation'::regclass
  ) then
    alter table public.standup_rotation add constraint standup_rotation_team_id_team_id_fk FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_rotation_user_id_user_id_fk' and conrelid = 'public.standup_rotation'::regclass
  ) then
    alter table public.standup_rotation add constraint standup_rotation_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_team_id_team_id_fk' and conrelid = 'public.standup'::regclass
  ) then
    alter table public.standup add constraint standup_team_id_team_id_fk FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_turn_organization_id_organization_id_fk' and conrelid = 'public.standup_turn'::regclass
  ) then
    alter table public.standup_turn add constraint standup_turn_organization_id_organization_id_fk FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_turn_standup_id_standup_id_fk' and conrelid = 'public.standup_turn'::regclass
  ) then
    alter table public.standup_turn add constraint standup_turn_standup_id_standup_id_fk FOREIGN KEY (standup_id) REFERENCES public.standup(id) ON DELETE CASCADE;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'standup_turn_user_id_user_id_fk' and conrelid = 'public.standup_turn'::regclass
  ) then
    alter table public.standup_turn add constraint standup_turn_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
  end if;
end $$;

commit;
