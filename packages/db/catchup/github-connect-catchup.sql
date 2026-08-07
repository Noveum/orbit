-- Brings a database created before the GitHub connect work up to the current schema.
-- Adds four tables: github_installation, github_repository, github_repository_link and
-- integration_oauth_state, and relaxes one existing column, github_repository_sync.team_id,
-- from not null to nullable so a repository can be watched at workspace level with no team.
--
--   integration_oauth_state holds one row per OAuth state Orbit mints for a GitHub or Slack
--   install round trip, keyed by the nonce carried inside the signed state. The callback
--   deletes the row it finds, so a state that is replayed a second time matches nothing and is
--   refused. Without the row the signature alone would keep verifying for the whole ten minute
--   window and the same callback could be replayed.
--
-- Why the tables look the way they do:
--   github_installation.installation_id carries a unique index with NO organization_id in it.
--   That is deliberate and it is the tenancy guard. A GitHub installation id is global, so a
--   unique index on it alone makes it physically impossible for a second Orbit workspace to
--   bind an installation another workspace already holds. Do not add organization_id to that
--   index: doing so would let two workspaces claim the same installation and read each other's
--   private repository names.
--
--   github_repository_link.project_id is nullable on purpose: a null row means the repository
--   is associated with the workspace rather than any one project. Postgres treats nulls as
--   distinct in a unique index, so uniqueness is expressed as two partial indexes instead of
--   one, otherwise a repository could collect unlimited duplicate workspace-level rows.
--
-- Safe to run more than once: every statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/github-connect-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.
--
-- This must be applied to the target database BEFORE the code that depends on it ships.

begin;

create table if not exists public.github_installation (
    id text NOT NULL,
    organization_id text NOT NULL,
    integration_id text NOT NULL,
    installation_id text NOT NULL,
    account_login text DEFAULT ''::text NOT NULL,
    account_id text DEFAULT ''::text NOT NULL,
    account_type text DEFAULT 'Organization'::text NOT NULL,
    repository_selection text DEFAULT 'selected'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    connected_by_id text NOT NULL,
    repositories_synced_at timestamp with time zone,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.github_repository (
    id text NOT NULL,
    organization_id text NOT NULL,
    installation_row_id text NOT NULL,
    repository_id text NOT NULL,
    full_name text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    owner_login text DEFAULT ''::text NOT NULL,
    private boolean DEFAULT false NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    default_branch text DEFAULT 'main'::text NOT NULL,
    html_url text DEFAULT ''::text NOT NULL,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.integration_oauth_state (
    nonce text NOT NULL,
    provider text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

create table if not exists public.github_repository_link (
    id text NOT NULL,
    organization_id text NOT NULL,
    repository_row_id text NOT NULL,
    project_id text,
    linked_by_id text,
    sync_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'github_installation_pkey'
    ) then
        alter table public.github_installation
            add constraint github_installation_pkey primary key (id);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_pkey'
    ) then
        alter table public.github_repository
            add constraint github_repository_pkey primary key (id);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_link_pkey'
    ) then
        alter table public.github_repository_link
            add constraint github_repository_link_pkey primary key (id);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_installation_organization_id_organization_id_fk'
    ) then
        alter table public.github_installation
            add constraint github_installation_organization_id_organization_id_fk
            foreign key (organization_id) references public.organization(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_installation_integration_id_integration_id_fk'
    ) then
        alter table public.github_installation
            add constraint github_installation_integration_id_integration_id_fk
            foreign key (integration_id) references public.integration(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_installation_connected_by_id_user_id_fk'
    ) then
        alter table public.github_installation
            add constraint github_installation_connected_by_id_user_id_fk
            foreign key (connected_by_id) references public."user"(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_organization_id_organization_id_fk'
    ) then
        alter table public.github_repository
            add constraint github_repository_organization_id_organization_id_fk
            foreign key (organization_id) references public.organization(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'github_repository_installation_row_id_github_installation_id_fk'
    ) then
        alter table public.github_repository
            add constraint github_repository_installation_row_id_github_installation_id_fk
            foreign key (installation_row_id) references public.github_installation(id)
            on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_link_organization_id_organization_id_fk'
    ) then
        alter table public.github_repository_link
            add constraint github_repository_link_organization_id_organization_id_fk
            foreign key (organization_id) references public.organization(id) on delete cascade;
    end if;

    -- Postgres truncates identifiers at 63 bytes, so this constraint is named with the
    -- already-truncated form the schema push produces. Spelling out the untruncated name here
    -- would make the existence check miss and the second run of this file would fail.
    if not exists (
        select 1 from pg_constraint
        where conname = 'github_repository_link_repository_row_id_github_repository_id_f'
    ) then
        alter table public.github_repository_link
            add constraint github_repository_link_repository_row_id_github_repository_id_f
            foreign key (repository_row_id) references public.github_repository(id)
            on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_link_project_id_project_id_fk'
    ) then
        alter table public.github_repository_link
            add constraint github_repository_link_project_id_project_id_fk
            foreign key (project_id) references public.project(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'github_repository_link_linked_by_id_user_id_fk'
    ) then
        alter table public.github_repository_link
            add constraint github_repository_link_linked_by_id_user_id_fk
            foreign key (linked_by_id) references public."user"(id) on delete set null;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'integration_oauth_state_pkey'
    ) then
        alter table public.integration_oauth_state
            add constraint integration_oauth_state_pkey primary key (nonce);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'integration_oauth_state_organization_id_organization_id_fk'
    ) then
        alter table public.integration_oauth_state
            add constraint integration_oauth_state_organization_id_organization_id_fk
            foreign key (organization_id) references public.organization(id) on delete cascade;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'integration_oauth_state_user_id_user_id_fk'
    ) then
        alter table public.integration_oauth_state
            add constraint integration_oauth_state_user_id_user_id_fk
            foreign key (user_id) references public."user"(id) on delete cascade;
    end if;
end
$$;

create unique index if not exists github_installation_installation_unique
    on public.github_installation using btree (installation_id);

create index if not exists github_installation_org_idx
    on public.github_installation using btree (organization_id);

create unique index if not exists github_repository_unique
    on public.github_repository using btree (installation_row_id, repository_id);

create index if not exists github_repository_org_idx
    on public.github_repository using btree (organization_id);

create unique index if not exists github_repository_link_project_unique
    on public.github_repository_link using btree (repository_row_id, project_id)
    where project_id is not null;

create unique index if not exists github_repository_link_workspace_unique
    on public.github_repository_link using btree (repository_row_id)
    where project_id is null;

create index if not exists github_repository_link_project_idx
    on public.github_repository_link using btree (project_id);

create index if not exists github_repository_link_org_idx
    on public.github_repository_link using btree (organization_id);

create index if not exists integration_oauth_state_expires_idx
    on public.integration_oauth_state using btree (expires_at);

alter table public.github_repository_sync alter column team_id drop not null;

commit;
