# ADR 0004: Workspace deletion uses durable cleanup

## Status

Accepted

## Context

Workspace data spans PostgreSQL and object storage, which cannot share a transaction. A failed cleanup must not allow new workspace data to appear or leave a deletion request without a safe retry path.

## Decision

Use a tenant-scoped durable deletion state. First block new workspace access and uploads in a short database transaction. After outstanding upload capabilities expire, delete only the exact workspace storage prefix. Finish with a short database transaction that rechecks authorization and deletes the workspace-owned graph through database cascades.

## Consequences

Storage and database failures leave a durable retry state rather than claiming success. The deletion flow must use exact storage-prefix validation, authorization checks at each transaction boundary, and tests that prove neighboring workspaces and shared user data remain intact.
