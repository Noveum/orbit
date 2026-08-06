-- Adds the partial index the sprint scope replay reads, issue_activity_cycle_moves_idx.
-- Nothing else in the schema changed: no table, column or constraint is touched, and no
-- existing index is dropped or rebuilt.
--
-- Correctness does not depend on it. cycleProgress replays the cycleId rows in
-- issue_activity for one organization from the day a sprint opened onwards, and without the
-- index that replay sequentially scans the busiest table in the app.
--
-- Safe to run more than once: the statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/sprint-scope-index-catchup.sql
-- using the direct connection on port 5432, not the pooler on 6543.
--
-- Building the index takes a share lock, which holds writes to issue_activity for as long as
-- it runs. To build it without blocking writes, run the statement below on its own through
-- psql instead, outside any transaction, and re-run it after dropping the leftover invalid
-- index if it fails partway:
--   create index concurrently if not exists issue_activity_cycle_moves_idx
--     on public.issue_activity (organization_id, created_at) where field = 'cycleId';

begin;

create index if not exists issue_activity_cycle_moves_idx
  on public.issue_activity using btree (organization_id, created_at)
  where field = 'cycleId';

commit;
