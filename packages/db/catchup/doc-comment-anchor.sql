-- Adds the anchor column that ties a doc comment to the passage it is about.
-- One nullable jsonb column on doc_comment: {quote, prefix, suffix, start}.
-- Existing rows keep a null anchor and stay attached to the whole document.
--
-- Safe to run more than once: the statement checks first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/catchup/doc-comment-anchor.sql
-- using the direct connection on port 5432, not the pooler on 6543.

begin;

alter table public.doc_comment add column if not exists anchor jsonb;

commit;
