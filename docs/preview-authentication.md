# Preview authentication

Every pull request gets a Worker Preview of the `orbit-pr` Worker, at
`https://<alias>-orbit-pr.<subdomain>.workers.dev`. The alias comes from the
branch name, as described in [Cloudflare Workers](cloudflare-workers.md#preview-deployments).
All previews share one preview database, separate from production, and never
share sessions with production.

## How a preview knows its own address

The preview build compiles `NEXT_PUBLIC_APP_URL` as the preview address, and the
deploy step sets `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same address
as variables of that preview. Sign-in, the session cookie, email links and the
MCP issuer all use that hostname.

`env.preview` in `apps/web/wrangler.jsonc` also sets
`ORBIT_AUTH_ALLOWED_HOSTS=*-orbit-pr.<subdomain>.workers.dev`, so the unique
deployment URL Cloudflare gives each preview upload is accepted as well. A
request whose host is missing or not allowed uses `BETTER_AUTH_URL` as the
origin. It never uses an unrecognised host.

A wildcard in `ORBIT_AUTH_ALLOWED_HOSTS` may only appear in the leftmost label,
needs at least two fixed labels after that label, and a label that is only `*`
needs at least three. `*-orbit-pr.acme.workers.dev` is accepted.
`*.workers.dev` and `*.example.com` are refused at startup, because they would
trust hosts that belong to other accounts or other deployments. Do not configure
a wildcard cookie domain.

## How people sign in

Previews run with `ORBIT_PASSWORD_AUTH=true` and no Google, GitHub, Slack,
GitHub App or Resend credentials. Create an account with an email address and a
password on the preview itself. Its accounts live in the preview database only.

Passkeys stay bound to the hostname they were registered on, so a passkey made
on one preview does not work on another.

## Social login on a preview

Social login is not configured on previews. To test it, set the same random
`OAUTH_PROXY_SECRET` of at least 32 characters on production and on the preview,
plus the provider credentials. Register only the production callback URLs with
the providers:

- `https://orbit.noveum.ai/api/auth/callback/google`
- `https://orbit.noveum.ai/api/auth/callback/github`

Google and GitHub then return to production, which exchanges the authorization
code and sends an encrypted, short-lived profile to the initiating preview. The
preview consumes its original state and creates the user and session in its own
database. Production and the preview do not need to share their session
secrets or databases.

## Access

The account's `workers.dev` subdomain sits behind Cloudflare Access, so team
members pass that gate before reaching Orbit's own login. Access does not
replace Orbit login or its email-domain restrictions.
