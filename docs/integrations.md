# Integrations

Orbit currently exposes GitHub as its supported external product integration.
It is optional and configured per workspace under **Settings**, **Integrations**.

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
   - **Checks**: read-only
   Do not grant organization or account permissions.
7. Subscribe to these events:
   - **Repository**
   - **Pull request**
   - **Pull request review**
   - **Check suite**
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

### Note on GitHub sign-in

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are a different thing. Those are
for signing in with GitHub, and they come from an OAuth app. You can have
either, both, or neither. See [Configuration](configuration.md#authentication).

## Email

Not an integration you connect, but worth listing since it carries invites and
magic links. Ordinary event notifications are currently in-app only.

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

**Pull requests do not link to issues.** The branch name has to contain the
issue identifier. Use the branch name Orbit generates, or include `ENG-42` in
your own.
