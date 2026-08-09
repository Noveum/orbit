begin;

update public.organization
set allowed_email_domains =
  case
    when allowed_email_domains @> '["noveum.ai"]'::jsonb then allowed_email_domains
    else allowed_email_domains || '["noveum.ai"]'::jsonb
  end ||
  case
    when allowed_email_domains @> '["yodu.ai"]'::jsonb then '[]'::jsonb
    else '["yodu.ai"]'::jsonb
  end
where id in (
  'org_noveum',
  'org_noveum_demo',
  '9970aaa7-ba5c-4fcc-b980-d16880ea6c41'
)
  and (
    not allowed_email_domains @> '["noveum.ai"]'::jsonb
    or not allowed_email_domains @> '["yodu.ai"]'::jsonb
  );

commit;
