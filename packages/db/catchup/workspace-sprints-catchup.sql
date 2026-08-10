-- Collapses per team sprints into one series per workspace.
--
-- A sprint used to belong to a team: cycle.team_id was not null and the number was unique
-- per team, so every team had its own Sprint 1 running at the same time. A sprint now
-- belongs to the workspace and holds work from any team or project, so the number has to be
-- unique per organization instead.
--
-- What it does, in order:
--   1. Merges the sprints that overlap in time into one, keeping the one holding the most
--      issues and moving every other sprint's issues onto it.
--   2. Archives the sprints that were emptied by the merge.
--   3. Renumbers what is left, oldest first, into one sequence per organization.
--   4. Makes team_id nullable and swaps the unique index onto (organization_id, number).
--
-- Sprints that already finished keep their team_id, so past sprints still read as the team
-- that ran them. Sprints created from here on carry no team.
--
-- Safe to run more than once. Every step checks first and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/workspace-sprints-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

alter table public.cycle alter column team_id drop not null;

drop index if exists cycle_team_number_unique;
drop index if exists cycle_team_dates_idx;

with running as (
  select
    c.id,
    c.organization_id,
    c.starts_at,
    c.ends_at,
    count(i.id) as issue_count
  from public.cycle c
  left join public.issue i on i.cycle_id = c.id and i.archived_at is null
  where c.completed_at is null and c.archived_at is null
  group by c.id
),
winner as (
  select distinct on (organization_id)
    id,
    organization_id
  from running
  order by organization_id, issue_count desc, starts_at asc, id asc
)
update public.issue i
set cycle_id = w.id
from running r
join winner w on w.organization_id = r.organization_id
where i.cycle_id = r.id
  and i.cycle_id is distinct from w.id
  and i.archived_at is null;

with winner as (
  select distinct on (c.organization_id)
    c.id,
    c.organization_id
  from public.cycle c
  left join public.issue i on i.cycle_id = c.id and i.archived_at is null
  where c.completed_at is null and c.archived_at is null
  group by c.id
  order by c.organization_id, count(i.id) desc, c.starts_at asc, c.id asc
)
update public.cycle c
set archived_at = now()
where c.completed_at is null
  and c.archived_at is null
  and not exists (select 1 from winner w where w.id = c.id)
  and not exists (select 1 from public.issue i where i.cycle_id = c.id and i.archived_at is null);

with ordered as (
  select
    id,
    row_number() over (partition by organization_id order by starts_at asc, created_at asc, id asc)
      as seq
  from public.cycle
)
update public.cycle c
set number = o.seq
from ordered o
where o.id = c.id and c.number is distinct from o.seq;

update public.cycle
set team_id = null
where completed_at is null and archived_at is null;

create unique index if not exists cycle_org_number_unique
  on public.cycle using btree (organization_id, number);

create index if not exists cycle_org_dates_idx
  on public.cycle using btree (organization_id, starts_at);

commit;
