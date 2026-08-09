-- Orders folders and pages the way they were made, oldest first, so anything new lands last.
--
-- Two things were never seeded:
--   doc_collection.position is 0 on every folder created before the column existed, so the
--   sidebar falls back to ordering by name and folders appear alphabetically.
--   doc.sort_order was seeded from updated_at, newest first, so editing an old page jumped
--   it to the top and a new page landed above everything.
--
-- Both are seeded from created_at ascending here, in steps of 1024 so a later drag has room
-- to land between two neighbours without renumbering anything.
--
-- This replaces any manual order somebody set by dragging. It is a one time correction of
-- data that was never ordered on purpose, not something to run on a schedule.
--
-- Safe to run more than once: it is derived entirely from created_at, so a second run
-- produces the same numbers.
--
-- Apply it with
--   bun --env-file=.env.production packages/db/src/apply-catchup.ts doc-order-by-creation.sql

begin;

with ranked as (
  select id,
         row_number() over (partition by organization_id order by created_at asc, id asc) as place
  from doc_collection
)
update doc_collection
set position = ranked.place * 1024
from ranked
where doc_collection.id = ranked.id;

with ranked as (
  select id,
         row_number() over (
           partition by organization_id, collection_id, project_id, parent_id
           order by created_at asc, id asc
         ) as place
  from doc
)
update doc
set sort_order = ranked.place * 1024
from ranked
where doc.id = ranked.id;

commit;
