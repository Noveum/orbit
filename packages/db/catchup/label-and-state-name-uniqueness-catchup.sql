-- Guarantees the three name uniqueness indexes that labels and workflow states now depend on:
-- label_org_name_unique, label_team_name_unique and workflow_state_team_name_unique.
--
-- No table and no column changes. All three indexes have been in the Drizzle schema since the
-- first migration, so a database created by db:push already has them and this file is a no-op.
-- It exists because the new /api/labels and /api/workflow-states routes turn the unique
-- violation into a 409 conflict, and a database missing an index would silently accept two
-- labels of the same name in one workspace instead.
--
-- Safe to run more than once: every statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was. If a statement fails on
-- duplicate rows, that is the real answer: the workspace already holds two rows the code now
-- forbids, and they have to be merged by hand before this file can be applied.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/label-and-state-name-uniqueness-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

create unique index if not exists label_org_name_unique
  on public.label using btree (organization_id, name)
  where team_id is null;

create unique index if not exists label_team_name_unique
  on public.label using btree (organization_id, team_id, name)
  where team_id is not null;

create unique index if not exists workflow_state_team_name_unique
  on public.workflow_state using btree (team_id, name);

commit;
