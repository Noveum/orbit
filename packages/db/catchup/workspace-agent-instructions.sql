begin;

alter table public.organization
  add column if not exists agent_instructions text;

update public.organization
set agent_instructions = ''
where agent_instructions is null;

alter table public.organization
  alter column agent_instructions set default '',
  alter column agent_instructions set not null;

commit;
