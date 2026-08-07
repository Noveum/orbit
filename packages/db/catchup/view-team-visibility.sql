-- Gives a saved view a real audience: view.visibility ('private', 'team' or 'workspace')
-- and view.team_id, the team a team scoped view belongs to.
--
-- Until now the only audience a view could record was view.shared, a boolean in a text
-- column, so a view someone believed was limited to their team was published to the whole
-- organization. listViews and the realtime scopes now read these two columns instead.
--
-- The backfill only touches rows that still carry the defaults, and only when the stored
-- filter or the old shared flag says the view was meant to be seen by someone other than
-- its owner. A view whose filter asks for 'team' but names a team that no longer exists,
-- or a team in another organization, becomes private rather than workspace wide: the
-- narrower reading is the safe one.
--
-- Safe to run more than once: every statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/view-team-visibility.sql
-- using the direct connection on port 5432, not the pooler on 6543.
--
-- Apply it before the code that reads the columns ships, otherwise every saved view query
-- fails on the missing column.

begin;

alter table public.view add column if not exists visibility text not null default 'private';
alter table public.view add column if not exists team_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'view_team_id_team_id_fk'
  ) then
    alter table public.view
      add constraint view_team_id_team_id_fk
      foreign key (team_id) references public.team (id) on delete cascade;
  end if;
end
$$;

create index if not exists view_team_idx on public.view using btree (team_id);

update public.view as v
set
  visibility = case
    when exists (
      select 1
      from public.team as t
      where t.id = v.filter ->> 'teamId'
        and t.organization_id = v.organization_id
    ) and v.filter ->> 'visibility' = 'team' then 'team'
    when v.filter ->> 'visibility' = 'team' then 'private'
    else 'workspace'
  end,
  team_id = case
    when exists (
      select 1
      from public.team as t
      where t.id = v.filter ->> 'teamId'
        and t.organization_id = v.organization_id
    ) and v.filter ->> 'visibility' = 'team' then v.filter ->> 'teamId'
    else null
  end
where v.visibility = 'private'
  and v.team_id is null
  and (v.shared = 'true' or v.filter ->> 'visibility' in ('team', 'workspace'));

update public.view
set shared = case when visibility = 'private' then 'false' else 'true' end
where shared <> case when visibility = 'private' then 'false' else 'true' end;

commit;
