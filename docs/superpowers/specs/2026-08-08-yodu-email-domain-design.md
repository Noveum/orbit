# Yodu Email Domain Design

## Goal

Allow email addresses whose domain is exactly `yodu.ai` to sign up for and receive invitations to the Noveum workspace. Keep `noveum.ai` allowed and continue rejecting domains that the workspace does not list.

## Scope

Orbit already supports multiple exact-match domains at both the server and workspace levels. This change will use that existing behavior. It will not add suffix matching, allow Yodu subdomains, or create a special case in authentication code.

The Noveum workspace defaults used by the database seed and both import paths will list `noveum.ai` and `yodu.ai`. The current Noveum workspace record will receive the same addition without removing any domains already configured there.

The global `ALLOWED_EMAIL_DOMAINS` setting will remain unchanged. A deployment that configures a nonempty global list must include both domains because the global and workspace lists are both enforced.

## Design

A small Noveum workspace configuration module in `packages/db` will own the default domain list. The seed, Plane import, and combined import will all use that shared value so future rebuilds cannot drift between paths.

The current workspace update will target only the Noveum organization and append `yodu.ai` idempotently. Before applying it, the target database and existing organization value will be inspected. No user, membership, invitation, or task data will change.

## Data Flow

When an invitation is created or a user is created, the existing organization service extracts the exact email domain. It checks the server allowlist when configured, then checks the workspace allowlist. With `yodu.ai` present in the Noveum workspace list, `hey@yodu.ai` passes both checks while `hey@team.yodu.ai` and unrelated domains remain rejected.

## Testing and Verification

A focused database-package test will protect the Noveum default policy and its use by the creation paths. Existing core invitation tests will continue to cover exact matching, multiple allowed domains, and rejection behavior.

The implementation will run the focused tests first, then `bun run verify`. The current workspace value will be read back after the scoped update to confirm that `yodu.ai` was added and existing domains were preserved.
