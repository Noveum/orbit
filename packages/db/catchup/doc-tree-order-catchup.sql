-- Backfill the manual order docs now carry inside their folder.
-- Existing docs were only ever ordered by updated_at, so seed sort_order from
-- that ordering within each (collection_id, project_id, parent_id) sibling set.
-- Run once per database that predates the doc tree ordering change.

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, collection_id, project_id, parent_id
      order by updated_at desc, id
    ) as position
  from doc
)
update doc
set sort_order = ranked.position * 1024
from ranked
where doc.id = ranked.id
  and doc.sort_order = 0;
