# ADR 0002: Public plans and private operations

## Status

Accepted

## Context

The public repository needs an auditable record of reusable engineering decisions. It must not become a distribution channel for tenant operations, current infrastructure targets, source exports, or temporary review coordination.

## Decision

Keep reusable project plans and ADRs in `docs/`. Use ADRs for decisions that continue to constrain future work. Keep tenant-specific operations in an access-controlled system outside the repository. The ignored `private-operations/` path is available only for a local, non-shipped working copy when an external system is not practical.

## Consequences

Public planning material must be written with fictional examples and exclude tenant identifiers, production commands, branch names, review logs, personal data, and credentials. A completed plan is reduced to durable ADRs before its execution state is archived or removed.
