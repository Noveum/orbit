# Readiness scope governance

The audited open source readiness scope is an independently pinned release-governance artifact. The current manifest is [`scripts/readiness-scope-manifest.ts`](../../scripts/readiness-scope-manifest.ts). The implementation plan and execution ledger are consumers of that manifest and cannot redefine its scope by changing together.

## Ownership

The manifest, stable plan, readiness ledger, checker, registry, and this procedure require review from both `@imshashank` and `@pulkitxm` through `CODEOWNERS`. Both approvals are required for a scope change. A finding owner may propose a change, but cannot approve a scope change alone.

## Current artifact

- Version: `readiness-scope/2026-08-09-v1`
- Findings: 41
- Priority distribution: 18 P0 and 23 P1
- Digest: `sha256:2795b5e40961a7607fc0d34cad098fd77a41cf38e457a3a2f1cf8fd99f50a74c`

The digest input is the version followed by the lexically sorted `ID:priority` pairs, one item per line, with a final newline. The checker recomputes this SHA-256 digest and rejects an invalid version, empty manifest, malformed pair, duplicate ID, or mismatch.

## Required change procedure

Any finding addition, removal, merge, split, rename, or priority change requires a dedicated scope pull request. It must not be bundled into a finding implementation or closure pull request.

The scope pull request must:

1. Link the approved audit or independent review that justifies the change without publishing undisclosed vulnerability detail.
2. Explain every old-to-new finding and priority mapping, including why no risk disappears from the governed inventory.
3. Update the stable plan, scope manifest, and ledger in the same change.
4. Increment the manifest version and replace its digest with the canonical digest for the new entries.
5. Keep every newly introduced or materially changed finding `Open` until its own closure evidence passes.
6. Add or update checker tests proving the old and new multisets and the intended transition.
7. Obtain both required CODEOWNER approvals after the final scope diff and digest are present.
8. Record the review decision and exact merged commit in the readiness implementation report.

The checker continues to validate raw plan rows, the plan multiset, and the ledger multiset independently. Removing or reprioritizing the same row in the plan and ledger therefore remains a failure until this governed manifest procedure is completed.

## Public and private detail

The manifest and ledger contain public outcome-level wording only. Reproduction steps, exploit material, secrets, personal data, and private object values belong in a private GitHub Security Advisory. A private record may justify a public scope change, but the public pull request must expose only the safe finding identifier, priority, outcome, and approval trail.
