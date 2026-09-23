# Instance administration design

Status: proposed follow-up. The current implementation provides setup guides
and environment presence checks. It does not save credentials from the UI or
grant an instance-administrator role.

## The problem

A self-hosted operator should be able to configure email and integration apps
without navigating source files. Orbit also permits people to register and
create their own workspaces. Making a workspace creator a server administrator
would let unrelated tenants replace the shared email sender, Slack application
or GitHub application.

Deliver this in two independently reviewable stages:

1. Keep Slack visible to workspace admins while disabled. Provide actionable
   email, Slack and GitHub guides, variable names, environment presence,
   deployment-specific provider URLs, a Slack manifest and manual verification
   steps. Preserve runtime capability gates and existing authorization.
2. Introduce an independently authorized instance-administration surface,
   encrypted shared service configuration, provider checks and an audit trail.
   Do not add editable secret fields to the current workspace settings page.

## Access and initial ownership

Use a dedicated instance-administrator assignment bound to a user ID. Workspace
roles and workspace creation must never confer this assignment. Enforce the new
permission in `packages/shared/src/policy` and every server operation. Do not
reuse `org:manage` as proof of server authority.

An operator supplies a cryptographically random, single-use setup token through
the hosting environment or a console command. Claiming requires an authenticated
account, the token and a recent authentication check. Do not choose an owner
from the first signup, first verified email, oldest workspace or an email-domain
match. Claiming must atomically create the assignment and consume the token,
with a database uniqueness constraint preventing simultaneous claims. Disable
claiming after initialization even if the environment token remains present.

Return generic failures and rate limit attempts by account and resolved client
address. Never place the token in a URL or persist it in browser storage. A
server-console recovery command should deliberately replace the assignment
after recent authentication checks can no longer be completed. Removing a
workspace or changing its membership must not accidentally transfer instance
ownership. Document the initial single-operator model and recovery procedure
before adding multi-operator delegation.

## Configuration storage and resolution

Store service configuration in a dedicated instance-scoped table, separate from
workspace OAuth connections. Use authenticated encryption with a versioned,
deployment-supplied encryption key. Bind ciphertext to the provider, instance
and schema version. Keep this encryption key outside the database, document its
backup and rotation procedure, and fail closed when it is missing or invalid.
Do not make it editable through the same UI it protects.

Use one asynchronous configuration resolver in the shared server packages. Every
consumer must use it: sign-in email, invitations, password reset, notification
delivery and reconciliation, Slack OAuth and webhooks, GitHub OAuth and app
requests, and scheduled maintenance. Writing `process.env` inside a web process
is not a configuration store and will not update other workers or serverless
instances.

Resolve each provider as a complete configuration group. Deployment environment
configuration has precedence and is marked as managed by the server environment.
If a partial environment group is present, report it as incomplete and locked;
do not silently combine it with unrelated stored credentials. Treat explicitly
disabled environment feature flags as authoritative. A database value must not
enable a feature the operator disabled in the environment.

Apply validated replacements atomically with optimistic version checks. A blank
secret input means keep the existing value, not erase it. Clearing credentials
is a separate confirmed operation with an explanation of affected connections.
Return only field presence, configuration source and sanitized validation
results. Never return secret values, suffixes or ciphertext to the browser.

Avoid a cache initially. Configuration traffic is low, and a database read per
operation is easier to make consistent than process-local cache invalidation.
If load justifies caching later, introduce shared versioned invalidation and a
bounded lifetime, with tests across multiple processes and cold starts.

## UI and service validation

Instance administration offers provider-specific forms and guided setup. The
workspace Integrations page continues to handle authorized OAuth installation,
channel mapping, repository selection and connection diagnostics. Show the
difference between settings saved, provider credentials verified, workspace
connected and a successful delivery. Store the timestamp and configuration
version associated with a verification result so changing credentials cannot
leave an obsolete green check.

Validation must match what each provider can prove. Validate local format before
saving, then use the provider's appropriate read-only endpoint or OAuth flow.
A Slack signing secret cannot be proven by checking its length; signed inbound
requests establish that path. Email delivery requires an explicit test to an
authorized verified recipient. Provider acceptance is different from delivery
to the mailbox. A Slack test message requires an explicit selected channel and
an authorized connection. Do not send messages just by opening Settings.

Require recent authentication for credential replacement and operator recovery.
Enforce origin/CSRF checks, bounded input sizes, fixed provider hosts, timeouts
and rate limits. Do not introduce an arbitrary URL probe. Redact provider
responses before displaying or logging them. Record actor, action, provider,
configuration version, time and outcome in the audit trail without credentials,
setup tokens or test message contents.

Registration-domain editing is a separate change from service configuration:
it affects authentication and invitation policy across the server. Keep the
existing environment allowlist until a shared resolver and lockout/recovery
tests cover every sign-in method. Database, Redis, object-storage endpoints,
authentication secrets and public URLs remain deployment-managed startup
configuration in this stage. First login still requires a deployment-provided
working authentication method.

## Required acceptance tests for stage two

- A workspace creator, another workspace's admin and an ordinary user cannot
  claim or change server settings without the setup token and operator role.
- Concurrent setup requests yield exactly one owner. A consumed token cannot
  be reused. Recovery is explicit and auditable.
- Secrets never appear in rendered HTML, API responses, logs or error messages.
  Encryption rejects the wrong provider, tampered data and a missing key.
- Environment precedence covers complete, partial, blank and explicitly disabled
  configurations. A stale edit cannot overwrite a newer configuration.
- Email, Slack and GitHub consumers observe the same update across web,
  webhook, scheduler and serverless processes without restart or environment
  mutation. In-flight work has an explicit credential-rotation policy.
- Verification results expire when configuration changes. Failed tests preserve
  working credentials and sanitize provider errors. Tests cannot send to an
  arbitrary recipient or probe an arbitrary URL.
- Backup and recovery preserve configuration, encryption keys and operator
  access without granting authority from restored workspace membership.

## Trade-offs

Environment-only setup keeps secrets with the deployment operator and works
across the existing runtimes, but is cumbersome for first-time operators.
Database-backed editing improves usability and avoids routine redeployments,
but introduces a new authorization boundary, key lifecycle and configuration
consistency contract. Stage one improves discovery immediately while stage two
earns that additional authority with migrations, integration tests and an
operator recovery path.
