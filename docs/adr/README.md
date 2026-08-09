# Architecture Decision Records

Architecture Decision Records capture durable, reusable decisions that shape Orbit's public implementation. They are short, standalone documents that explain the context, decision, and consequences without reproducing temporary execution detail.

## Retention and placement

Public plans may describe reusable project work, technical alternatives, implementation sequencing, and verification criteria. They must use fictional examples and omit tenant identifiers, operational targets, production commands, branch names, review logs, and personal data.

Tenant operations belong outside the repository. Store source exports, production runbooks, tenant mappings, and current-environment commands in an access-controlled system. If a local working copy is unavoidable, use the ignored `private-operations/` directory and never add its contents to a commit.

When an active public plan is complete, retain only the decisions that remain useful to future contributors as ADRs. Archive or delete its execution checklist after those decisions are recorded. The open-source-readiness plan remains public while it is active. Its exception permits its own implementation sequence, audit evidence, and verification criteria only. It does not permit tenant operations, credentials, personal data, or unrelated branch and review coordination. Its completed decisions will be distilled under this directory before its execution state is archived.

## Records

- [0002: Public plans and private operations](0002-public-plans-and-private-operations.md)
- [0003: Workspace email-domain policy is configuration](0003-workspace-email-domain-policy-is-configuration.md)
- [0004: Workspace deletion uses durable cleanup](0004-workspace-deletion-uses-durable-cleanup.md)
