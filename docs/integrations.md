# Integrations

Orbit connects to GitHub and Slack. Both are optional, and both are configured
per workspace under **Settings**, **Integrations**.

When an integration is not configured, Orbit hides the affordance rather than
showing a button that fails. If a connect button is missing, the environment
variable behind it is unset.

For the MCP server, which is how AI assistants connect, see [MCP server](mcp.md).

## GitHub

Links pull requests to issues, so the board reflects what is actually happening
in the repository without anyone updating it by hand.

What you get:

- A **Pull requests** view, showing open pull requests against the issues they
  close.
- Pull requests **linked to an issue** and shown on it, with their state.
- **Branch names** generated from an issue, so the link is automatic. The
  command palette and the `copy_branch_name` MCP tool both produce them.

### Setting it up

This needs a [GitHub App](https://docs.github.com/en/apps), not an OAuth app.
GitHub Apps are installed per repository and their tokens are short lived, which
is the right shape for something reading your code host.

1. Create a GitHub App, under your organisation if the repositories belong to
   one.
2. Set the callback URL to `https://orbit.example.com/api/integrations/github/callback`.
3. Tick **Request user authorization (OAuth) during installation**. This is not
   optional. It is what makes GitHub send a `code` back with the installation,
   and that code is the only evidence Orbit has that the person finishing the
   flow actually controls the installation they named. A callback without one is
   refused.
4. Set the webhook URL to `https://orbit.example.com/api/webhooks/github`, and
   set a webhook secret.
5. Give it these repository permissions:
   - **Contents**: read
   - **Metadata**: read
   - **Pull requests**: read and write
6. Subscribe to **Pull request** and **Push** events.
7. Generate a private key and download the PEM, and note the app's client ID and
   a generated client secret.

Then set:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-app-slug
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=<the client secret you generated>
GITHUB_WEBHOOK_SECRET=<the secret you set>
```

The private key is multi-line. Escaped `\n` sequences are handled, so you can
paste it as one line into a hosting dashboard that will not take newlines.

`GITHUB_APP_SLUG` is what makes the connect button appear.
`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are what let it discover
repositories. `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are what let
it exchange the callback code and confirm the installation belongs to the person
connecting, so it refuses to connect anything without them rather than binding an
installation it cannot attribute. All five need to be set for the flow to
complete.

Then go to **Settings**, **Integrations**, **GitHub**, connect, and pick which
repositories to install it on.

### Note on GitHub sign-in

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are a different thing. Those are
for signing in with GitHub, and they come from an OAuth app. You can have
either, both, or neither. See [Configuration](configuration.md#authentication).

## Slack

Sends notifications where the team already is.

What you get:

- **Notifications in Slack**, following the same per-event preferences and quiet
  hours as everywhere else.
- **Channel routing**, so a team's activity goes to that team's channel.
- **Standup posted to Slack**, which combined with the MCP server means an agent
  can run standup and post the summary without anyone opening Orbit.

### Setting it up

1. Create a Slack app at <https://api.slack.com/apps>, from scratch.
2. Under **OAuth & Permissions**, add the redirect URL
   `https://orbit.example.com/api/integrations/slack/callback`.
3. Add these bot token scopes:
   - `chat:write`
   - `channels:read`
   - `groups:read`
   - `users:read`
   - `users:read.email`
4. Under **Event Subscriptions**, set the request URL to
   `https://orbit.example.com/api/webhooks/slack`.
5. Copy the client id, client secret and signing secret from **Basic
   Information**.

Then set:

```bash
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
```

The signing secret verifies that inbound requests are really from Slack. Without
it Slack requests are rejected, which is the correct behaviour but confusing if
you forgot to set it.

Then go to **Settings**, **Integrations**, **Slack**, connect, and pick the
channels.

`users:read.email` is what matches Slack accounts to Orbit accounts, so people
get their own notifications rather than a channel getting everyone's.

## Email

Not an integration you connect, but worth listing since it is what carries
invites and magic links.

Orbit sends through [Resend](https://resend.com) only.

```bash
RESEND_API_KEY=re_...
EMAIL_FROM="Orbit <orbit@example.com>"
```

`EMAIL_FROM` must be on a domain verified in Resend. If it is not, every send
fails, and the only symptom anyone sees is that invites never arrive.

## Webhooks out

Orbit does not send outbound webhooks yet. It is on the [roadmap](roadmap.md),
and it is one of the more requested things.

Until then the MCP server covers most of what people want webhooks for, since an
agent can poll or be triggered and has full read access.

## When one does not work

**The connect button is missing.** The environment variable behind it is unset.
GitHub needs `GITHUB_APP_SLUG`, Slack needs `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Restart after setting them.

**OAuth redirects to an error.** The callback URL registered with the provider
does not exactly match your deployment, including scheme and trailing slash.
Check `NEXT_PUBLIC_APP_URL` too, since the redirect is built from it.

**Webhooks arrive but nothing happens.** The signature is not verifying. Confirm
`GITHUB_WEBHOOK_SECRET` or `SLACK_SIGNING_SECRET` matches what the provider has.
Both providers show recent deliveries and their responses, which is the fastest
place to look.

**Pull requests do not link to issues.** The branch name has to contain the
issue identifier. Use the branch name Orbit generates, or include `ENG-42` in
your own.

**Slack notifications go to a channel but not to people.** The
`users:read.email` scope is missing, so Slack accounts cannot be matched to
Orbit accounts. Add it and reinstall the app.
