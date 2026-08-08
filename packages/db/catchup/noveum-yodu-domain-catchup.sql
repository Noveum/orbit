begin;

update public.organization
set allowed_email_domains = allowed_email_domains || '["yodu.ai"]'::jsonb
where id in ('org_noveum', 'org_noveum_demo')
  and not allowed_email_domains @> '["yodu.ai"]'::jsonb;

commit;
