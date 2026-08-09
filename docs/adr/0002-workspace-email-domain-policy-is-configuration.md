# ADR 0002: Workspace email-domain policy is configuration

## Status

Accepted

## Context

Organizations can need different sets of permitted email domains. A source organization should not determine the default policy of a new installation or require an authentication special case.

## Decision

Enforce the existing exact-match email-domain policy through deployment and workspace configuration. Keep authentication and invitation behavior independent of any organization name, identifier, or domain list.

## Consequences

New installations choose their own allowed domains. Tenant domain changes are operator configuration, not tracked catch-up SQL or seeded source-organization data. Tests use fictional domains and verify the generic exact-match contract.
