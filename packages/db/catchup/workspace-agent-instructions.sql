begin;

alter table public.organization
  add column if not exists agent_instructions text not null default '';

commit;
