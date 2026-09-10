# Preview authentication

Keep `BETTER_AUTH_URL` set to the stable OAuth callback origin in production and
previews. For the hosted Orbit project this is `https://orbit.noveum.ai`.

Set `ORBIT_AUTH_ALLOWED_HOSTS=orbit-*-magicapi.vercel.app` in both Vercel
environments. The auth server also accepts the canonical hostname and the exact
`VERCEL_URL` and `VERCEL_BRANCH_URL` provided by Vercel. Browser authentication
uses the current origin, so password and email OTP sessions stay on the preview.

Set a dedicated random `OAUTH_PROXY_SECRET` of at least 32 characters to the same
value in production and previews. Do not put its value in source control. This
enables Better Auth's OAuth proxy in both environments without requiring their
main session secrets or databases to match.

Register only the stable callback URLs with the OAuth providers:

- `https://orbit.noveum.ai/api/auth/callback/google`
- `https://orbit.noveum.ai/api/auth/callback/github`

Deploy the proxy code to production before testing social login on previews.
Google and GitHub return to production, which exchanges the authorization code
and sends an encrypted, short-lived profile to the initiating preview. The
preview consumes its original state and creates the user and session in its own
database. The session cookie belongs to that preview hostname.

Keep Vercel Authentication enabled for deployment URLs. Team members must pass
that gate before starting Orbit login. This does not replace Orbit login or its
email-domain restrictions. Do not configure a wildcard cookie domain on
`vercel.app` or allow all Vercel customers as auth origins.

Existing immutable deployments do not acquire this code or new environment
variables. Redeploy their branches after the production proxy is available.
Passkeys remain bound to their registration hostname; use Google, GitHub, or
email OTP when testing a newly generated preview hostname.
