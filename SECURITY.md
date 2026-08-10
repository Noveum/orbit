# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** A public issue tells
everyone running Orbit about the hole at the same moment it tells us, and most
of them cannot patch as fast as an attacker can read.

Report it one of two ways:

- [Open a private advisory](https://github.com/Noveum/orbit/security/advisories/new)
  on GitHub. This is the preferred route, because it keeps the discussion,
  the fix and the disclosure in one place.
- Or email <shashank@noveum.ai> with `SECURITY` in the subject.

Please include:

- What the problem is and roughly how bad you think it is.
- Steps to reproduce, or a proof of concept.
- The version, commit or deployment you found it on.
- Whether anyone else already knows.

You will get an acknowledgement within 72 hours. We will confirm or reject the
report within seven days, and tell you our plan and rough timeline either way.
For a confirmed issue we aim to ship a fix within 30 days, sooner when it is
being exploited.

We will credit you in the advisory unless you would rather stay anonymous. Just
say which you prefer.

## Supported versions

Orbit ships continuously from `main` and there are no long lived release
branches yet. Fixes land on `main` and go out with the next deployment.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Anything older | Upgrade to `main` |

If you self-host, track `main` or a recent tag. There is no backporting.

## What counts

In scope:

- Authentication and session handling, including passkeys, magic links, OAuth
  and the dev login route.
- Authorization. Anything that lets a user read or change something their role
  in `packages/shared/src/policy` should not allow, or that crosses a workspace
  or team boundary.
- The realtime hub. A scope decides who is delivered a row, so a client
  receiving an event it should not see is a real vulnerability, not a bug.
- The MCP OAuth server and token validation, including a token acting outside
  the scopes it was granted.
- Injection of any kind, SSRF, and unsafe deserialization.
- Stored or reflected XSS, particularly through markdown, doc content or issue
  titles.
- The file upload and presigned URL flow.
- Webhook signature verification for GitHub and Slack.
- Secrets leaking into responses, logs or the client bundle.

Out of scope:

- Anything that needs `ORBIT_DEV_LOGIN=1`, which is a local development
  convenience and must never be set on a deployed environment. If you find a way
  to turn it on remotely, that is very much in scope.
- Missing hardening headers with no demonstrated impact.
- Rate limiting on endpoints where the damage is only noise.
- Findings from an automated scanner with no working reproduction.
- Denial of service through raw volume.
- Social engineering, physical attacks, and anything touching third party
  services rather than Orbit.
- Self-hosted deployments misconfigured by their operator, for example a public
  Postgres with the default password. See the checklist below.

## Testing

Please test against your own local instance. Do not test against
<https://orbit.noveum.ai> or any other deployment you do not own. If a finding
genuinely cannot be shown without touching hosted Orbit, email first and we will
set something up with you.

## Self-hosting checklist

Most real world incidents with self-hosted software come from configuration, not
from code. Before you expose an Orbit instance:

- Set `BETTER_AUTH_SECRET` to a fresh random value. The one in `.env.example` is
  a placeholder and it is public.
- Never set `ORBIT_DEV_LOGIN` on a deployed environment. It signs anyone in as
  any seeded user with one click.
- Never set `NEXT_PUBLIC_REALTIME_URL` in production. The socket is served from
  the app's own origin at `/api/ws`, and Orbit ignores this variable in
  production.
- Do not expose Postgres, Redis or object storage to the internet. Orbit is the
  only thing that needs to reach them.
- Change every default credential from `docker-compose.yml`, which is built for
  local development and nothing else.
- Set `ALLOWED_EMAIL_DOMAINS` if your instance should only admit your own
  organisation. It is enforced on invite creation and on user creation, so it
  covers every provider.
- Scope the uploads bucket CORS policy to your origin. See `infra/s3-cors.json`.
- Serve over HTTPS. Session cookies and the websocket ticket both depend on it.

## Our commitments

We will not take legal action against anyone acting in good faith under this
policy. We will not ask you to stay quiet forever. Once a fix has shipped and
users have had a reasonable window to update, publish whatever you like.
