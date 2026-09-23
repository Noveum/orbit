# First-run setup and administration

An installation has two distinct administrative responsibilities. The server
operator configures infrastructure and provider secrets in the hosting
environment. A workspace admin manages that workspace's members, teams,
preferences and connected integrations. Creating a workspace grants the creator
the workspace admin role; it never grants access to server secrets or other
workspaces. There is no shared default admin account or default password.

Workspace creation, membership changes and invitations use Orbit's API and its
shared authorization policy. The authentication plugin exposes only workspace
session switching; its parallel organization management endpoints are disabled.

## Bootstrap an account

Configure at least one complete first-login method before building: password
sign-up (`ORBIT_PASSWORD_AUTH=true`), Google OAuth, GitHub OAuth, or Resend with a
non-local sender. Use the deployment's HTTPS origin for authentication and public
URLs. Passkeys require an existing authenticated account and cannot bootstrap a
fresh installation. Production ignores the development login shortcut.

Sign in, complete the profile, create a workspace, and create its first team.
Every workspace creator becomes admin of their own workspace. The first account
on the server has no special instance-wide privileges. Registration is open
unless `ALLOWED_EMAIL_DOMAINS` restricts it. A domain allowlist restricts claimed
addresses; it does not verify address ownership. For a private installation,
prefer a verified email or OAuth sign-in method and restrict registration.

Password registration can bootstrap a personal workspace without email. It does
not verify ownership of the entered address. Joining an invited workspace
requires a verified address. Sign in using an emailed code or a provider that
verifies the invited address before accepting. An unverified account cannot
discover pending invitations during onboarding or accept them through the API.

When an email code first verifies an existing password account, authentication
revokes its earlier sessions and password so the verified mailbox owner does
not inherit credentials created before ownership was proven. After verification,
set a new password in **Settings > Account > Password** or use password recovery.

## Configure email and integrations

Open **Settings > Deployment setup** as a workspace admin. The page lists
required variable names and configuration status without returning secret
values. Server-side workspace policy protects the page. A configured credential
is not evidence of successful delivery or authentication.

Set `RESEND_API_KEY` and `EMAIL_FROM` on a domain verified by Resend, then rebuild
and redeploy. Email codes, invitations, password-reset email and email
notifications use this provider. Without email configuration, onboarding can
continue, but email actions are unavailable and explain what the operator must
configure. Existing notification preferences are preserved. Configure email
before relying on password recovery or inviting teammates.

GitHub sign-in credentials are separate from the GitHub App integration.
Configure the app credentials, callback, permissions and webhook secret before
installing it for a workspace. Slack requires its feature flag and app
credentials, workspace authorization, and individual connections for personal
DMs. Follow [Configuration](configuration.md) for the variable reference.

Push delivery is not implemented in this release. Its notification controls are
disabled and saved preferences are preserved. Use the inbox, configured email,
or connected Slack DMs for delivered notifications.

## Verify the running installation

1. Complete a real sign-up, sign-out and sign-in. Reload a protected page and
   confirm the session persists. Register and test a passkey if using one.
2. Create a workspace and team. Create, edit and complete a task, then reload
   and confirm it remains. Check access from a second account with a different
   role and workspace.
3. Create and edit a document. Upload a file, preview it and download it. Restart
   the app and confirm both document content and file bytes remain available.
4. With configured email, test a code and password reset using a controlled
   mailbox. Invite a second user, verify their address, accept the invite, and
   confirm the requested role. Check provider delivery results.
5. Test notification preferences and each connected integration separately.
   Missing provider credentials mean that capability is unconfigured, not tested.
6. Change a task with two browser windows open. Confirm the other updates
   without reloading before claiming realtime support.
7. Configure authenticated cron requests for notification retries, sprint
   rollover, analytics snapshots and pruning. Verify actual executions, not just
   the presence of `CRON_SECRET`. Back up and test restoring the database and
   object storage together before keeping important data.

## Provider limits

Vercel's Node runtime provides the WebSocket upgrade bridge used by `/api/ws`.
The Docker preview supplies a separate Node realtime host using the same shared
hub, a gateway routing `/api/ws`, and an authenticated maintenance scheduler.
A RepoCloud VPS must install the complete stack and configure public HTTPS and
storage addresses; a running VPS alone does not deploy Orbit. Running only the
Next standalone HTTP server omits realtime and maintenance.

A Netlify Next.js deployment is not currently an equivalent supported target.
Its functions do not supply the Vercel-specific WebSocket bridge, and the
Vercel cron declaration does not configure a Netlify scheduler. Validate adapter
behavior, all infrastructure, authentication and background work before
publishing a one-click template. See [self-hosting](self-hosting.md) and the
[Docker preview](docker-preview.md) for the current deployment boundaries.
