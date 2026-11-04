begin;

alter table public.team
  add column if not exists instructions text;

update public.team
set instructions = ''
where instructions is null;

alter table public.team
  alter column instructions set default '',
  alter column instructions set not null;

alter table public.project
  add column if not exists instructions text;

update public.project
set instructions = ''
where instructions is null;

alter table public.project
  alter column instructions set default '',
  alter column instructions set not null;

commit;
