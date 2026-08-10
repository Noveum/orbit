# Readiness scope governance

The audited open source readiness scope is an independently pinned release-governance artifact. The canonical machine-readable manifest is [`scripts/readiness-scope-manifest.json`](../../scripts/readiness-scope-manifest.json). The TypeScript module beside it is trusted checker code and is not a scope-change input. The implementation plan and execution ledger are consumers of the manifest and cannot redefine its scope by changing together.

## Ownership and enforcement boundary

`CODEOWNERS` routes the governed files to `@imshashank` and `@pulkitxm`, but GitHub accepts approval from any one owner listed on a rule. `CODEOWNERS` does not enforce two approvals.

The tracked `Readiness scope policy` workflow runs for the listed `pull_request_target` lifecycle events. A submitted, edited, or dismissed `pull_request_review` event requests revalidation only when its reviewer is `@imshashank` or `@pulkitxm`; unrelated reviews do not start the policy job. The workflow applies only to pull requests targeting `main`. It checks out only the exact base commit, fetches the pull request head as Git objects, reads the hard-coded governed artifacts and inert registry JSON as bounded data, and runs only trusted base code. It never checks out, imports, installs, or executes pull request code. Each successfully authorized run first writes a pending `Trusted readiness policy` status to the captured pull request head, then replaces it with success or failure.

For semantic scope changes, the policy requires the latest opinionated review from both named maintainers to be `APPROVED` on the exact head SHA. Immediately before success, it fetches the current pull request and review history again, confirms that the base and head are unchanged, and repeats the exact-head approval decision. In supported token contexts, an eligible review event refreshes the policy result. GitHub may downgrade the token for a fork-originated review event and prevent that run from writing a status. Maintainers must then rerun the current trusted `pull_request_target` job after the final reviews. The external ruleset, stale-approval dismissal, and required-review controls remain authoritative in either case.

The policy authenticates hosted evidence while a finding moves to `Ready for closure`, validates the prior Ready decision again when a later pull request seals the finding, and validates durable closure seals from committed Git artifacts thereafter. Governed artifacts must be ordinary regular files with valid UTF-8 and bounded bytes. Governed JSON must have unique keys and the required canonical byte form.

The workflow job named `Trusted readiness scope policy` runs against the base commit, so that job name is not the pull request head gate. Tracked code cannot configure or prove the repository ruleset. Repository administrators must configure an active ruleset that requires the explicit head status `Trusted readiness policy`, requires the branch to be current, dismisses stale approvals, and applies the required reviewer controls. Until that external ruleset is active and verified, the workflow is an auditable check rather than a guaranteed merge block. This is a P0 bootstrap requirement.

GitHub does not assign the readiness workflow a numeric workflow ID until the workflow exists on the default branch. The introducing pull request must not invent or predeclare that ID. After the trusted workflow definition reaches `main`, maintainers must confirm its active GitHub identity and complete the ruleset setup before relying on readiness closure enforcement.

## Manifest contract

The current version, finding set, priority distribution, and digest live in the manifest and changing execution ledger rather than being copied into this stable procedure. Each manifest entry pins the finding ID, priority, SHA-256 hash of the canonical public finding, and SHA-256 hash of the canonical required outcome. The manifest digest hashes the JSON serialization of `schema`, `version`, and the lexically ID-sorted entries. The checker independently verifies the plan text, ledger text, semantic hashes, manifest digest, IDs, priorities, and exact plan-to-ledger wording.

## Trust-root update procedure

After this policy is active on `main`, every trust-root change requires a dedicated policy-update pull request with exact-head approval from both named maintainers. Trust roots comprise `CODEOWNERS`, every workflow and repository-local action, `bun.lock`, every root or workspace `package.json` and `bunfig.toml`, the readiness validator, ledger and scope checkers, evidence verifier, trusted Git artifact reader, reference-registry wrapper, and scope-manifest wrapper. The only permitted companion files are this procedure, the pull request template, and the three readiness policy test files. A policy-update pull request cannot include the plan, ledger, scope audit JSON, manifest JSON, registry JSON, or product files.

The trusted base version of the policy enforces this shape and the two approvals, then re-fetches the final review state before success. The introducing pull request cannot enforce this rule on itself. The default-branch workflow identity and external ruleset bootstrap described above must be completed before maintainers treat this boundary as an active merge control.

## Required change procedure

Any governed finding addition, removal, merge, split, rename, reprioritization, finding-wording change, or required-outcome change requires a dedicated scope pull request. It must not be bundled with implementation, closure, product, policy, checker, workflow, or registry changes.

The scope pull request changes exactly these four files:

- `docs/superpowers/plans/2026-08-09-open-source-readiness.md`
- `docs/maintainers/readiness-ledger.md`
- `scripts/readiness-scope-manifest.json`
- `docs/maintainers/readiness-scope-audit.json`

The audit record must link a canonical `Noveum/orbit` audit or independent review, identify every changed finding ID, bind the old and new versions and digests, explain why no risk disappears, and contain only public outcome-level detail. The manifest revision must increase by exactly one. Every added or materially changed finding that remains in the head manifest must be `Open` with pending evidence. Both named maintainers must approve the final head.

Changes to the checker, policy workflow, manifest wrapper, or policy tests use a separate pull request. This prevents a scope change from weakening the trusted validator that judges it.

Finding implementation and closure do not change audited scope. After an implementation pull request is squash-merged and direct `main` CI produces passing candidate evidence, an evidence pull request changes exactly the ledger and inert registry JSON and moves the finding to `Ready for closure`. The trusted-base workflow validates its hosted evidence before posting the explicit head status. That pull request must merge as evidence commit M before a separate seal pull request is opened. One pull request cannot both introduce the Ready snapshot and seal it.

The seal pull request changes exactly the ledger and inert registry JSON, moves the finding from `Ready for closure` to `Closed` or `Accepted P1 exception`, and adds the durable closure record for M. The trusted checker derives the unique merged `Noveum/orbit` pull request associated with M and requires that it targeted `main`. It then locates the prior `Trusted readiness policy` success on that evidence pull request head. The status target must identify the exact successful Actions run and attempt. The run's top-level target repository must be `Noveum/orbit`; its pull request entry must match the authenticated number, head, and base. Nested repository fields in that entry are not a trust source because live GitHub responses may return them as null. The run must also match the event, active workflow identity, trusted workflow path, trusted workflow definition digest, and pre-merge chronology. M must be in the seal base ancestry. The checker also compares the staged snapshot at M with the seal digest. Both pull requests leave the plan, manifest, audit record, trusted validator, and workflow unchanged.

Any ledger state change involving `Ready for closure`, `Closed`, or `Accepted P1 exception` must use the exact ledger-and-registry file shape. Hosted Ready proof is loaded only for a transition from a Ready base row to a sealed head row. A later pull request may change product files when terminal ledger rows remain byte-for-byte unchanged. For those unchanged sealed rows, the checker validates the durable Git proof without fetching the earlier pull request, status, workflow run, or finite-retention artifacts again. A valid durable seal remains authoritative after hosted artifacts expire and after later product commits because it binds the reviewed evidence snapshot at M.

## Public and private detail

The manifest and ledger contain public outcome-level wording only. Reproduction steps, exploit material, secrets, personal data, and private object values belong in a private GitHub Security Advisory. A private record may justify a public scope change, but the public pull request exposes only the safe identifier, priority, outcome, mapping, and approval trail.
