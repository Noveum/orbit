-- Repairs saved views whose stored state cannot be read, and reports the ones nobody can
-- repair mechanically.
--
-- Two separate defects landed in view.filter.
--
-- The first is a format defect. A legacy client wrote the whole ViewState as a JSON string
-- instead of a JSON object, so the column holds "{\"filter\": ...}" rather than {"filter": ...}.
-- readViewState now unwraps that on read, and this script normalises it on disk so nothing has
-- to keep unwrapping it. That part is a real repair: the settings are all there, only the
-- encoding is wrong.
--
-- The second is a content defect and this script deliberately does not touch it. Four views
-- saved on 2026-08-07 at 08:12 UTC stored {"kind":"group","children":[],"combinator":"and"},
-- an empty condition group, because the create boundary accepted a filter written in some
-- other shape and silently dropped every key it did not recognise. The names say what they
-- were meant to hold, the rows do not, and nothing in the database records the intent. Writing
-- a guessed filter into somebody's saved view would be worse than leaving it, so the last
-- statement only lists them. Give the list to each owner: opening the view, rebuilding the
-- filter and pressing Save changes fixes it, and the boundary now rejects the shape that broke
-- them rather than storing an empty group.
--
-- Safe to run more than once. The normalisation only selects rows that are still strings, so a
-- second run finds nothing, and the report never writes. The whole thing is one transaction, so
-- a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/view-filter-repair.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

do $$
declare
  candidate record;
  decoded jsonb;
  unwrapped integer;
begin
  for candidate in
    select id, name, filter from public.view where jsonb_typeof(filter) = 'string'
  loop
    decoded := candidate.filter;
    unwrapped := 0;
    while jsonb_typeof(decoded) = 'string' and unwrapped < 4 loop
      begin
        decoded := (decoded #>> '{}')::jsonb;
      exception when others then
        raise notice 'view % (%) holds a string that is not JSON, left untouched', candidate.id, candidate.name;
        decoded := null;
      end;
      exit when decoded is null;
      unwrapped := unwrapped + 1;
    end loop;

    if decoded is null then
      continue;
    end if;

    if jsonb_typeof(decoded) <> 'object' then
      raise notice 'view % (%) decodes to a %, left untouched', candidate.id, candidate.name, jsonb_typeof(decoded);
      continue;
    end if;

    if jsonb_typeof(decoded -> 'filter') is distinct from 'object'
       or jsonb_typeof(decoded -> 'filter' -> 'children') is distinct from 'array' then
      raise notice 'view % (%) decodes to an object that is not a view state, left untouched', candidate.id, candidate.name;
      continue;
    end if;

    update public.view set filter = decoded where id = candidate.id;
    raise notice 'view % (%) unwrapped % layer(s) of encoding', candidate.id, candidate.name, unwrapped;
  end loop;
end
$$;

select
  v.id,
  v.name,
  v.visibility,
  u.email as owner_email,
  v.created_at
from public.view v
join public."user" u on u.id = v.owner_id
where jsonb_typeof(v.filter) = 'object'
  and coalesce(jsonb_array_length(v.filter -> 'filter' -> 'children'), 0) = 0
order by v.created_at;

commit;
