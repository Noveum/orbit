-- Drops the four module tables the app never displayed: module, module_member,
-- module_issue and module_link. A Plane import before #287 filled them, nothing
-- has read them since, and Orbit does not want a second mid-sized grouping next
-- to projects, milestones and sprints (#196).
--
-- The same drop ships as a migration for databases that run the ledger. Run this
-- script by hand on databases whose schema was materialized without one, so they
-- do not keep the tables after the release notes say they are gone.
--
-- Safe to run more than once: every statement checks first, and the whole thing
-- is one transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   bun --env-file=.env.production packages/db/src/apply-catchup.ts drop-module-tables-catchup.sql

begin;

drop table if exists public.module_link;
drop table if exists public.module_issue;
drop table if exists public.module_member;
drop table if exists public.module;

commit;
