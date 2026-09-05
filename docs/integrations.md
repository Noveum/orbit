# Integrations

Orbit includes GitHub and Slack as optional external product integrations. Each
is configured per workspace under **Settings**, **Integrations**. Slack remains
hidden until the deployment operator completes provider setup and enables its
global server-side gate.

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
- Every open pull request in a watched repository, with its activity, reviews,
  comments and checks. Linked Orbit tasks and projects appear as context.
- **Branch names** generated from an issue, so the link is automatic. The
  command palette and the `copy_branch_name` MCP tool both produce them.

### Setting it up

This needs a [GitHub App](https://docs.github.com/en/apps), not an OAuth app.
GitHub Apps are installed per repository and their tokens are short lived, which
is the right shape for something reading your code host.

1. Create a GitHub App, under your organization if the repositories belong to
   one.
2. Set the **Callback URL** to `https://orbit.example.com/api/integrations/github/callback`.
3. Tick **Request user authorization (OAuth) during installation**. This is not
   optional. It is what makes GitHub send a `code` back with the installation,
   and that code is the only evidence Orbit has that the person finishing the
   flow actually controls the installation they named. A callback without one is
   refused.
4. Leave the **Setup URL** empty, or set it to that same callback. This is a
   different field from the Callback URL and it is the one that decides where
   GitHub sends somebody after they install. Point it at a page rather than the
   callback and the install finishes in the browser without Orbit ever seeing
   it: the settings page fills with `installation_id` and `setup_action` in the
   address bar, nothing is saved, and the workspace still reads Not connected.
   Orbit now recognises that landing and says so, but the fix is here.
5. Set the webhook URL to `https://orbit.example.com/api/webhooks/github`, and
   set a webhook secret.
6. Apply the verified least privilege set from
   [GitHub App permissions and events](github-app.md):
   - **Metadata**: read-only
   - **Pull requests**: read-only
   - **Issues**: read-only
   - **Checks**: read-only
   - **Commit statuses**: read-only
   - **Actions**: read-only
   Do not grant organization or account permissions.
7. Subscribe to these events:
   - **Repository**
   - **Pull request**
   - **Pull request review**
   - **Pull request review comment**
   - **Pull request review thread**
   - **Issue comment**
   - **Check suite**
   - **Check run**
   - **Status**
   - **Workflow run**
   GitHub delivers `installation` and `installation_repositories` automatically.
8. Generate a private key and download the PEM, and note the app's client ID and
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

## Slack

Slack has one global, server-side capability gate. When `SLACK_ENABLED=true`,
Slack becomes available to every current and future Orbit organization. False
or unset keeps the settings card hidden, makes Slack routes return not found,
stops inbound event processing, and leaves the scheduled Slack DM worker with
no eligible work.

Global availability does not merge tenant data or credentials. Each Orbit
organization needs its own manager-authorized OAuth connection. OAuth state is
bound to the initiating Orbit organization and user, bot credentials are
encrypted with organization and integration context, and one Slack workspace
can belong to only one Orbit organization. Channel mappings, notifications,
and unfurls remain scoped to the owning organization and mapped Orbit team.

### Set up the Slack app

Configure the app with the OAuth redirect URL for your deployment:

```text
https://orbit.example.com/api/integrations/slack/callback
```

Request exactly these eight Bot Token Scopes:

- `channels:read`
- `groups:read`
- `chat:write`
- `links:read`
- `links:write`
- `im:write`
- `users:read`
- `users:read.email`

The webhook request URL is:

```text
https://orbit.example.com/api/webhooks/slack
```

Subscribe the bot to `link_shared` and add only your Orbit deployment hostname,
such as `orbit.example.com`, under Link unfurling. Slack requires an app
reinstall when unfurl domains change. Use Slack's HTTP Events API, not Socket
Mode. Orbit does not require slash commands or interactive issue mutations.

Activate public distribution in Slack before enabling Orbit's global gate. A
private Slack app can be installed only in its development workspace, so public
distribution is required for managers from other Slack workspaces to complete
OAuth.

### Launch order

1. Keep `SLACK_ENABLED=false` or unset. Regenerate every Slack credential that
   has been exposed in chat, screenshots, logs, or shell history. Revoke unused
   app-level and bot tokens. Orbit needs only the client ID, client secret, and
   signing secret.
2. Store the new `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` as sensitive
   deployment values, configure `SLACK_CLIENT_ID`, and apply the database
   migration that enforces unique Slack workspace ownership.
3. Deploy the Slack-capable code while the global gate remains false. Verify
   the deployment and migration before changing Slack's public availability.
4. Configure the OAuth redirect URL, bot scopes, Events API request URL,
   `link_shared` subscription, and unfurl domain in Slack. Reinstall the app if
   Slack requires it after a scope or domain change, then activate public
   distribution.
5. Set `SLACK_ENABLED=true` and redeploy. This enables Slack for every current
   and future Orbit organization, so treat it as a global release rather than a
   workspace-specific setting.
6. As a manager in a test Orbit organization, complete OAuth from **Settings**,
   **Integrations**. Invite the Orbit bot to a controlled Slack channel, map the
   channel to an Orbit team or the explicit workspace-wide scope, then test an
   outbound notification and an issue-link unfurl before announcing support.

Do not set `SLACK_ENABLED=true` before the migration, dark deployment,
credential rotation, Slack configuration, and public distribution are
complete. Public distribution alone does not enable Slack inside Orbit.

### Channel and credential behavior

The bot must be invited or joined before a channel can be mapped. Orbit fetches
the channel's canonical metadata from Slack and does not trust client-supplied
channel details. An unmapped channel does not unfurl. A team mapping limits
unfurls to issues in that exact Orbit team. A null team mapping is an explicit
workspace-wide scope, not an implicit fallback.

OAuth stores the bot token encrypted at rest. Rotating `BETTER_AUTH_SECRET`
makes existing encrypted Slack credentials unusable, so reconnect Slack as an
Orbit administrator after the rotation. The token is not shown in settings or
route responses.

Slack integration behavior:

- **Capability boundary.** OAuth credentials and public distribution alone do
  not enable Slack. `SLACK_ENABLED=true` is the global server-side release gate.
  An organization still needs its own authorized OAuth connection before it can
  send or receive Slack activity.
- **Tenant boundary.** The global gate changes feature availability only.
  Organization authorization, unique Slack workspace ownership, encrypted
  credentials, canonical joined-channel mappings, and organization and team
  scoping continue to isolate every connection and delivery.
- **Granted scope storage.** Granted scopes are stored as non-secret
  integration metadata. The bot token is never exposed to the browser.
- **Notification routing.** The GitHub webhook broadcast path sends eligible
  pull request activity to configured team channels. Generic team and project
  notifications are not yet dispatched to Slack channels. Personal
  notifications use Slack DMs when the recipient is mapped and has that channel
  enabled.
- **Availability states.** Notification settings distinguish available,
  unmapped, reauthorization-required, and unavailable states so a user is not
  offered a DM preference that the current integration cannot satisfy.
- **Quiet hours.** Non-urgent Slack DMs are deferred until the quiet-hours
  window ends; urgent assignments can bypass quiet hours using the existing
  notification setting. A DM-only notification with no other enabled channel
  is persisted with a deferred delivery time and sent after quiet hours end.
- **Delivery guarantee.** Slack DMs use at-least-once delivery. A worker claim
  that is not finalized within five minutes is reclaimed so an interrupted
  send is not silently lost. If Slack accepted the message immediately before
  the worker stopped, the retry can produce a duplicate DM because
  `chat.postMessage` does not provide a documented idempotency contract. The
  replacement claim becomes authoritative, and a late worker cannot finalize
  the superseded attempt. The scheduled worker runs every minute, takes small
  concurrent batches, and stops claiming new work before its runtime deadline.
- **Member mapping.** OAuth loads the complete Slack user directory before it
  maps every current Orbit workspace member whose normalized email has exactly
  one matching active human Slack user. Ambiguous emails remain unmapped so a
  private notification cannot be routed to an arbitrary account.
- **Member resynchronization.** Workspace admins can use **Sync Slack members**
  in integration settings to refresh a healthy connection without repeating
  OAuth. Newly joined Orbit members remain unmapped until a workspace admin
  runs **Sync Slack members** again. Connections with missing directory scopes,
  unusable credentials, or a reauthorization requirement must reconnect first.
  Orbit replaces the mapping snapshot atomically only after every Slack
  directory page succeeds. The settings panel reports how many current
  workspace members are matched.

### Note on GitHub sign-in

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are a different thing. Those are
for signing in with GitHub, and they come from an OAuth app. You can have
either, both, or neither. See [Configuration](configuration.md#authentication).

## Email

Not an integration you connect, but worth listing since it carries invites and
sign-in codes. Event notification email and digests are not currently
dispatched. Slack channel delivery remains limited to channels explicitly
mapped by each Orbit organization.

Orbit sends through [Resend](https://resend.com) only.

```bash
RESEND_API_KEY=re_...
EMAIL_FROM="Orbit <orbit@example.com>"
```

`EMAIL_FROM` must be on a domain verified in Resend. If it is not, every send
fails, including sign-in codes and invitations.

## Webhooks out

Orbit does not send outbound webhooks yet. It is on the [roadmap](roadmap.md),
and it is one of the more requested things.

Until then the MCP server covers most of what people want webhooks for, since an
agent can poll or be triggered and has full read access.

## When one does not work

**The install finished but the workspace still says Not connected, and the
address bar shows `installation_id` and `setup_action`.** The App's **Setup
URL** points at a page instead of `/api/integrations/github/callback`, so GitHub
handed the install to the browser and Orbit never saw it. Fix the Setup URL, then
connect again. Nothing needs undoing first: the installation on GitHub is real,
it was only never recorded.

**The install finished and Orbit says it could not verify who owns it.**
**Request user authorization (OAuth) during installation** is unticked, so
GitHub sent no `code` and Orbit refused to bind an installation it cannot
attribute to the person connecting. Tick it, confirm `GITHUB_APP_CLIENT_ID` and
`GITHUB_APP_CLIENT_SECRET` are set, then connect again.

**The connect button is missing.** `GITHUB_APP_SLUG` is unset. Restart after
setting it.

**OAuth redirects to an error.** The callback URL registered with GitHub
does not exactly match your deployment, including scheme and trailing slash.
Check `NEXT_PUBLIC_APP_URL` too, since the redirect is built from it.

**Webhooks arrive but nothing happens.** The signature is not verifying. Confirm
`GITHUB_WEBHOOK_SECRET` matches what the GitHub App has. The integrations page
shows recent deliveries and their responses, which is the fastest place to look.

**Slack says the workspace is already claimed.** That Slack team is bound to a
different Orbit organization. Disconnect Slack from its current Orbit workspace
first, then reconnect from the intended organization. Do not try to bypass the
ownership check or copy credentials between workspaces.

**Slack reports missing permissions, says it needs authorization, or it stopped
working after a `BETTER_AUTH_SECRET` rotation.** Reconnect Slack as an Orbit
administrator. This replaces the encrypted OAuth credential and renews the
granted scope. Do not attempt to recover or paste a stored token.

**A channel cannot be mapped, or mapped links do not unfurl.** Invite or join
the Orbit bot to that exact Slack channel, then map it again. Confirm that the
mapping is enabled and that the channel has the intended exact team scope or
explicit workspace-wide scope. Unmapped channels deliberately do not unfurl.

**Pull requests do not link to issues.** The branch name has to contain the
issue identifier. Use the branch name Orbit generates, or include `ENG-42` in
your own.
