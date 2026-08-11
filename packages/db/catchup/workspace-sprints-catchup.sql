-- Collapses per team sprints into one series per workspace.
--
-- A sprint used to belong to a team: cycle.team_id was not null and the number was unique
-- per team, so every team had its own Sprint 1 running at the same time. A sprint now
-- belongs to the workspace and holds work from any team or project, so the number has to be
-- unique per organization instead, and two open sprints may no longer overlap.
--
-- What it does, in order:
--   1. Groups the open sprints of each workspace into runs that overlap in time. A run is a
--      chain of sprints where each one starts before the previous one has ended.
--   2. Merges each run into the sprint in it holding the most work, moving the issues of the
--      others onto it. Sprints in different runs are left where they are, so a sprint
--      planned for next month stays next month rather than being pulled into this one.
--   3. Archives the sprints emptied by that merge.
--   4. Renumbers what is left, oldest first, into one sequence per organization.
--   5. Makes team_id nullable, points its foreign key at set null rather than cascade, clears
--      it on the sprints that are still open, and swaps the unique index onto
--      (organization_id, number).
--
-- Sprints that already finished keep their team_id, so past sprints still read as the team
-- that ran them. Sprints that are still open carry no team from here on.
--
-- No issue is deleted or detached: every issue either stays where it is or moves onto the
-- sprint its own run was merged into.
--
-- Safe to run more than once. Every step checks first and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/workspace-sprints-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

alter table public.cycle alter column team_id drop not null;

-- The old foreign key deleted a team's sprints with the team. A sprint now outlives the team
-- that used to run it, and the column is only the label that team left behind, so the delete
-- action has to let go of the sprint rather than take it with it.
alter table public.cycle drop constraint if exists cycle_team_id_team_id_fk;
alter table public.cycle
  add constraint cycle_team_id_team_id_fk
  foreign key (team_id) references public.team (id) on delete set null;

drop index if exists cycle_team_number_unique;
drop index if exists cycle_team_dates_idx;

create temporary table sprint_runs on commit drop as
with open_cycles as (
  select id, organization_id, starts_at, ends_at
  from public.cycle
  where completed_at is null and archived_at is null
),
marked as (
  select
    id,
    organization_id,
    starts_at,
    ends_at,
    case
      when starts_at >= coalesce(
        max(ends_at) over (
          partition by organization_id
          order by starts_at, id
          rows between unbounded preceding and 1 preceding
        ),
        starts_at
      ) then 1
      else 0
    end as opens_a_run
  from open_cycles
)
select
  id,
  organization_id,
  starts_at,
  sum(opens_a_run) over (
    partition by organization_id
    order by starts_at, id
    rows unbounded preceding
  ) as run
from marked;

create temporary table sprint_run_winners on commit drop as
select distinct on (r.organization_id, r.run)
  r.id,
  r.organization_id,
  r.run
from sprint_runs r
left join public.issue i on i.cycle_id = r.id and i.archived_at is null
group by r.organization_id, r.run, r.id, r.starts_at
order by r.organization_id, r.run, count(i.id) desc, r.starts_at asc, r.id asc;

update public.issue i
set cycle_id = w.id
from sprint_runs r
join sprint_run_winners w on w.organization_id = r.organization_id and w.run = r.run
where i.cycle_id = r.id
  and i.cycle_id is distinct from w.id
  and i.archived_at is null;

update public.cycle c
set archived_at = now()
from sprint_runs r
where r.id = c.id
  and not exists (select 1 from sprint_run_winners w where w.id = c.id)
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
where completed_at is null and archived_at is null and team_id is not null;

create unique index if not exists cycle_org_number_unique
  on public.cycle using btree (organization_id, number);

create index if not exists cycle_org_dates_idx
  on public.cycle using btree (organization_id, starts_at);

commit;
