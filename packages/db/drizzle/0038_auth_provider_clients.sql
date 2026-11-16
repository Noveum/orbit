DO $migration$
DECLARE unsupported integer;
BEGIN
  PERFORM 1 FROM "oauth_application" legacy WHERE legacy."provider_migrated_at" IS NULL FOR UPDATE;
  SELECT count(*) INTO unsupported FROM "oauth_application" legacy
  WHERE legacy."provider_migrated_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "oauth_provider_client" existing WHERE existing."client_id" = legacy."client_id") AND NOT (
    (legacy."type" = 'public' AND coalesce(legacy."client_secret", '') = '') OR
    (legacy."type" = 'web' AND coalesce(legacy."client_secret", '') <> '')
  );
  IF unsupported > 0 THEN
    RAISE EXCEPTION 'Unsupported legacy OAuth client records must be reviewed before the auth upgrade (% rows)', unsupported;
  END IF;
  BEGIN
    WITH candidates AS MATERIALIZED (
      SELECT legacy."metadata" FROM "oauth_application" legacy
      WHERE legacy."provider_migrated_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "oauth_provider_client" existing WHERE existing."client_id" = legacy."client_id")
    )
    SELECT count(*) INTO unsupported FROM candidates
    WHERE coalesce(jsonb_typeof(nullif("metadata", '')::jsonb), 'object') NOT IN ('object', 'null');
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Legacy OAuth client metadata must be valid JSON before the auth upgrade';
  END;
  IF unsupported > 0 THEN
    RAISE EXCEPTION 'Legacy OAuth client metadata must be a JSON object before the auth upgrade (% rows)', unsupported;
  END IF;
END
$migration$;
--> statement-breakpoint
WITH candidates AS MATERIALIZED (
  SELECT legacy.* FROM "oauth_application" legacy
  WHERE legacy."provider_migrated_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "oauth_provider_client" existing WHERE existing."client_id" = legacy."client_id")
)
INSERT INTO "oauth_provider_client" (
  "id", "client_id", "client_secret", "disabled", "skip_consent", "enable_end_session",
  "scopes", "client_credentials_scopes", "user_id", "created_at", "updated_at", "name", "icon",
  "redirect_uris", "token_endpoint_auth_method", "application_type", "grant_types", "response_types",
  "require_p_k_c_e", "dpop_bound_access_tokens", "metadata", "legacy_auth_methods", "legacy_resource_migration_pending"
)
SELECT
  legacy."id", legacy."client_id",
  CASE WHEN legacy."type" = 'public' THEN NULL ELSE
    rtrim(translate(encode(sha256(convert_to(legacy."client_secret", 'UTF8')), 'base64'), '+/', '-_'), '=') END,
  legacy."disabled", false, false,
  ARRAY['openid', 'profile', 'email', 'offline_access', 'orbit.read', 'orbit.write'],
  ARRAY[]::text[], legacy."user_id", legacy."created_at", legacy."updated_at", legacy."name", legacy."icon",
  string_to_array(legacy."redirect_urls", ','),
  CASE WHEN legacy."type" = 'public' THEN 'none' ELSE 'client_secret_basic' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM unnest(string_to_array(legacy."redirect_urls", ',')) uri
    WHERE uri !~* '^https?:' OR uri ~* '^http://(127\.0\.0\.1|\[::1\]|localhost)(:[0-9]+)?(/|$)'
  ) THEN 'native' ELSE 'web' END,
  ARRAY['authorization_code', 'refresh_token'], ARRAY['code'], true, false,
  coalesce(nullif(legacy."metadata", '')::jsonb, '{}'::jsonb), legacy."type" = 'web', true
FROM candidates legacy
ON CONFLICT ("client_id") DO NOTHING;
--> statement-breakpoint
UPDATE "oauth_application" legacy
SET "provider_migrated_at" = now()
WHERE legacy."provider_migrated_at" IS NULL AND EXISTS (
  SELECT 1 FROM "oauth_provider_client" existing WHERE existing."client_id" = legacy."client_id"
);
