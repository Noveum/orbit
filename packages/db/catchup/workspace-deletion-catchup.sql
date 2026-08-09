-- Brings a database up to the schema the permanent workspace deletion work introduced.
-- Adds two nullable timestamps and nothing else:
--   organization.deletion_requested_at, which marks a workspace as pending deletion
--   attachment.upload_expires_at, which bounds how long an unfinished upload is honoured
--
-- Without the first, every page fails: resolving which workspaces a user belongs to
-- selects it, so the whole app answers 42703 column organization.deletion_requested_at
-- does not exist.
--
-- Safe to run more than once: both statements check first, and the whole thing is one
-- transaction, so a failure leaves the database exactly as it was.
--
-- Apply it either by pasting it into the Supabase SQL editor, or with
--   bun --env-file=.env.production packages/db/src/apply-catchup.ts workspace-deletion-catchup.sql

begin;

alter table public.organization
  add column if not exists deletion_requested_at timestamptz;

alter table public.attachment
  add column if not exists upload_expires_at timestamptz default now() + interval '900 seconds';

commit;
