UPDATE "doc"
SET "publish_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "visibility" in ('workspace', 'members')
  AND ("publish_token" is null or "publish_token" = '');
