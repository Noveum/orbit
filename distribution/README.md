# Distribution metadata

This directory is the upstream source of truth for Orbit's public listings and submission campaign.

- `orbit.json` contains stable product facts, approved copy, links, categories, alternatives, and asset paths.
- `submissions.json` records where Orbit has been submitted, what evidence exists, and what is still blocked or awaiting review.

## Rules

1. Update a product fact in `orbit.json` before copying it into a directory or app-store manifest.
2. Record a channel as `submitted` or `pending` only when there is a real submission response, ticket, email, or review URL.
3. Record a channel as `live` only after its public listing has been verified.
4. Do not store passwords, tokens, session cookies, private claim URLs, or payment information here.
5. Do not remove the self-hosting Preview disclosure until the production deployment release gate is complete.
6. Do not select paid, expedited, sponsored, or featured placement without an explicit maintainer decision.
7. Do not create duplicate submissions while an existing request is pending.
8. Platform-specific deployment manifests must use immutable release versions and digests after production images exist. They must not depend on `latest`.

## Updating a submission

For each channel, preserve the stable `id` and update:

- `status`
- `submittedAt`
- `account`
- `evidence`
- `publicUrl`
- `blocker`
- `nextAction`

Use these statuses:

- `planned`: researched and not yet submitted
- `submitted`: accepted by a submission mechanism; no review result yet
- `pending`: under review, awaiting indexing, or awaiting an ownership challenge
- `live`: public listing verified
- `blocked`: a known eligibility, login, policy, or technical gate prevents submission
- `deferred`: intentionally postponed, commonly because payment or launch timing needs a separate decision
- `skipped`: confirmed unsuitable or obsolete route

## Copy boundaries

The approved variants in `orbit.json` have different length and disclosure requirements. Do not replace them with one automatically truncated paragraph.

- The MCP Registry description must remain at most 100 characters.
- The directory tagline must remain at most 60 characters.
- The short directory description must remain at most 160 characters.
- The Product Hunt description must remain at most 260 characters.
- Self-hosting-oriented copy must say that provider-neutral production self-hosting is currently Preview.

## Verification

The root distribution test checks the most important invariants:

- copy length limits
- HTTPS and approved contact metadata
- required self-hosting disclosure
- canonical MCP identity consistency with `server.json` and the public server card
- referenced asset existence
- unique channel identifiers and valid statuses
- absence of secrets and paid-placement data in the ledger

Run the root test suite before opening a distribution metadata pull request.
