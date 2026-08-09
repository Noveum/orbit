# Readiness scope governance

The audited open source readiness scope is an independently pinned release-governance artifact. The canonical machine-readable manifest is [`scripts/readiness-scope-manifest.json`](../../scripts/readiness-scope-manifest.json). The TypeScript module beside it is trusted checker code and is not a scope-change input. The implementation plan and execution ledger are consumers of the manifest and cannot redefine its scope by changing together.

## Ownership and enforcement boundary

`CODEOWNERS` routes the governed files to `@imshashank` and `@pulkitxm`, but GitHub accepts approval from any one owner listed on a rule. `CODEOWNERS` does not enforce two approvals.

The tracked `Readiness scope policy` workflow uses `pull_request_target`, checks out only the exact base commit, fetches the pull request head as Git objects, reads the hard-coded governed artifacts and inert registry JSON as bounded data, and runs only trusted base code. It queries the GitHub review API and requires the latest opinionated review from both named maintainers to be `APPROVED` on the exact head SHA for semantic scope changes. It never checks out, imports, installs, or executes pull request code. It authenticates hosted evidence while a finding is `Ready for closure`, validates durable closure seals from committed Git artifacts, and writes the explicit `Trusted readiness policy` commit status to the captured pull request head.

The workflow job named `Trusted readiness scope policy` runs against the base commit, so that job name is not the pull request head gate. Tracked code cannot configure or prove the repository ruleset. Repository administrators must configure an active ruleset that requires the explicit head status `Trusted readiness policy`, requires the branch to be current, dismisses stale approvals, and applies the required reviewer controls. `pull_request_target` does not run when a review is submitted or dismissed, so maintainers must rerun the trusted policy job after both final approvals unless a separately trusted GitHub App refreshes it. Until that external ruleset and rerun procedure are configured, the workflow is an auditable check rather than a guaranteed merge block.

## Manifest contract

The current version, finding set, priority distribution, and digest live in the manifest and changing execution ledger rather than being copied into this stable procedure. Each manifest entry pins the finding ID, priority, SHA-256 hash of the canonical public finding, and SHA-256 hash of the canonical required outcome. The manifest digest hashes the JSON serialization of `schema`, `version`, and the lexically ID-sorted entries. The checker independently verifies the plan text, ledger text, semantic hashes, manifest digest, IDs, priorities, and exact plan-to-ledger wording.

## Required change procedure

Any governed finding addition, removal, merge, split, rename, reprioritization, finding-wording change, or required-outcome change requires a dedicated scope pull request. It must not be bundled with implementation, closure, product, policy, checker, workflow, or registry changes.

The scope pull request changes exactly these four files:

- `docs/superpowers/plans/2026-08-09-open-source-readiness.md`
- `docs/maintainers/readiness-ledger.md`
- `scripts/readiness-scope-manifest.json`
- `docs/maintainers/readiness-scope-audit.json`

The audit record must link a canonical `Noveum/orbit` audit or independent review, identify every changed finding ID, bind the old and new versions and digests, explain why no risk disappears, and contain only public outcome-level detail. The manifest revision must increase by exactly one. Every added or materially changed finding that remains in the head manifest must be `Open` with pending evidence. Both named maintainers must approve the final head.

Changes to the checker, policy workflow, manifest wrapper, or policy tests use a separate pull request. This prevents a scope change from weakening the trusted validator that judges it.

Finding implementation and closure do not change audited scope. After an implementation pull request is squash-merged and direct `main` CI produces passing candidate evidence, an evidence pull request changes exactly the ledger and inert registry JSON and moves the finding to `Ready for closure`. The trusted-base workflow validates its hosted evidence before posting the explicit head status. After that pull request merges as evidence commit M, a separate seal pull request changes exactly the same two files, moves the finding to `Closed` or `Accepted P1 exception`, and adds the durable closure record for M. The trusted checker compares the staged snapshot at M with the seal digest. Both pull requests leave the plan, manifest, audit record, trusted validator, and workflow unchanged.

Any ledger state change involving `Ready for closure`, `Closed`, or `Accepted P1 exception` must use the exact ledger-and-registry file shape. A later pull request may change product files when terminal ledger rows remain byte-for-byte unchanged. A valid durable seal remains authoritative after hosted artifacts expire and after later product commits because it binds the reviewed evidence snapshot at M.

## Public and private detail

The manifest and ledger contain public outcome-level wording only. Reproduction steps, exploit material, secrets, personal data, and private object values belong in a private GitHub Security Advisory. A private record may justify a public scope change, but the public pull request exposes only the safe identifier, priority, outcome, mapping, and approval trail.
