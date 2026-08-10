<!-- Thanks for contributing. Keep this short. The parts reviewers actually read are what changed and how you know it works. -->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link the issue: Closes #123 -->

Closes #

## How you know it works

<!-- The test you added, the manual check you ran, or both. "A feature is not done until it has a test that would fail if the feature broke." -->

## Readiness finding closure

<!-- Complete this section only when the pull request claims to close a finding in docs/maintainers/readiness-ledger.md. Do not include undisclosed vulnerability details. Use a private GitHub Security Advisory for those details. Terminal closure and P1 exception decisions require human assignment records and subject-level independence. -->

- Finding ID:
- Accountable owner role:
- Accountable owner reference (`principal:<key>`):
- Registry entries added or updated, including HTTPS links, exact evidence kinds, canonical human aliases, and full immutable commit identities:
- Merged implementation pull request identity, its squash commit C, and implementation evidence (`implementation:record:<key>`):
- Failing-first pull request attempt with distinct full head commit F, exact Actions attempt URL, artifact digest, and final passing evidence (`test:first=record:<failing-key>;passing=record:<passing-key>`), or approved non-behavioral evidence (`test-na:record:<key>;justification=record:<key>;approver=principal:<key>`):
- Candidate C full 40-character SHA and exact `https://github.com/Noveum/orbit/commit/<sha>` URL:
- Direct `main` test and gate Actions attempt URLs, SHA-256 artifact digests, plus decision and non-behavioral attestation URLs and timestamps:
- Lifecycle stage for this pull request (`Ready for closure` evidence or later terminal seal):
- For a seal pull request, evidence commit M, its separately merged Ready evidence pull request, the durable closure record, and the canonical snapshot digest:
- For a seal pull request, the prior `Trusted readiness policy` status target and authenticated workflow run identity derived for M:
- Release-gate evidence (`gate:record:<key>`):
- Documentation evidence (`docs:record:<key>`):
- Residual-risk record (`risk:record:<key>`):
- Decision record (`decision:record:<key>;implementation=principal:<key>;finding=principal:<key>;approver=principal:<key>`):
- Independent Release approver (`approver:principal:<key>`):
- Security authority (`authority:principal:<key>`) or `not-required`:
- P1 exception expiry, mitigation evidence, and substantive public limitation:
- Audited scope change, if any, with exact four-file scope pull request, structured audit record, manifest version and digest, and both exact-head approvals:

## Readiness trust-root update

<!-- Complete this section when changing CODEOWNERS, a workflow or local action, the lockfile, package or Bun configuration, or readiness policy runtime code. -->

- Trust-root files changed:
- Permitted governance or policy-test companions changed:
- Both named exact-head approvals:
- Workflow definition digests updated and verified, if applicable:

## Screenshots

<!-- Anything visual needs a before and after. Both themes if you touched styling. Delete this section if the change is not visual. -->

## Checklist

- [ ] `bun run verify` is green
- [ ] Tests added or updated, and they fail without the change
- [ ] Every closure field uses its ledger structured reference format and resolves through the registry.
- [ ] A behavior-change closure links separate failing-first and final-passing records with immutable commits. Non-behavioral work has the approved structured `test-na` record.
- [ ] The implementation pull request was squash-merged first as candidate C. Direct `main` CI at C succeeded before the evidence pull request changed only the ledger and inert registry JSON and moved the row to `Ready for closure`.
- [ ] A `Closed` or `Accepted P1 exception` transition is a separate, later seal pull request opened after the Ready evidence pull request merged as M. It changes only the ledger and inert registry JSON and adds exactly one durable closure record binding C, M, and the staged snapshot digest.
- [ ] Final test, release gate, decision, implementation, and any non-behavioral attestation agree on C and its exact commit URL. The implementation baseline is not used as a candidate.
- [ ] Git proves the baseline precedes C. For staged evidence, only the approved evidence files changed from C to the head. For a seal, C properly precedes M, M properly precedes the seal head, and C through M has the exact evidence-file shape.
- [ ] The failing record binds distinct PR-head commit F to the implementation pull request. The GitHub API proves that pull request merged as C and that its failing test attempt used F.
- [ ] Before M merges, final test and gate records use direct `main` CI, exact immutable Actions attempt URLs, the trusted CI workflow identity and definition digest, exact job and step provenance, and unexpired candidate-bound artifact digests.
- [ ] The seal checker can derive exactly one merged `main` pull request for M and bind its prior successful `Trusted readiness policy` status to the exact successful run, attempt, pull request head and base, top-level target repository, active workflow identity, trusted workflow path, trusted definition digest, and pre-merge chronology. It does not rely on nested pull request repository fields that may be null.
- [ ] Hosted Ready proof is required only for the Ready-to-terminal seal transition. Later product pull requests keep terminal rows unchanged and rely on the durable Git seal without re-fetching expired hosted evidence.
- [ ] Every authored registry entry is valid, duplicate source keys are absent, and intentional human aliases point to one canonical human assignment.
- [ ] Historical audit records appear only as residual-risk evidence.
- [ ] Terminal owner, decision, approval, and authority principals resolve to HTTPS human assignment records with stable subject identifiers.
- [ ] The registered owner role matches the ledger, and the implementation, finding-owner, and Release-approver subjects are distinct.
- [ ] Security-required findings use an independent subject with the exact `Security maintainer` role without publishing private details.
- [ ] A P1 exception has a future expiry and matches its finding's owner, risk, decision, approver, and authority records.
- [ ] A human reviewer confirmed that every public limitation is semantically substantive, concrete, and free of placeholder wording.
- [ ] Any scope change follows `docs/maintainers/readiness-scope-governance.md`, uses the exact four-file shape, increments the semantic manifest, updates the audit record, and has both exact-head approvals verified by the trusted policy workflow. Submitted, edited, and dismissed reviews by either named required reviewer request revalidation, and the policy re-fetches the final reviews immediately before success. If a fork-originated review event cannot write status, a maintainer reran the current trusted `pull_request_target` job.
- [ ] Any trust-root change uses a dedicated policy-update pull request with both named exact-head approvals. It contains only trust-root files and permitted governance, pull request template, or readiness policy test companions, with no governed plan, ledger, audit, manifest, registry state, or product files.
- [ ] Repository administrators verified that an active ruleset requires the explicit `Trusted readiness policy` head status, a current branch, stale-approval dismissal, and required reviewer controls. The base-bound workflow job name is not a substitute.
- [ ] The readiness workflow is already active on the default branch before any closure relies on it. Its GitHub-assigned numeric ID was observed after that merge rather than invented in the introducing pull request.
- [ ] No comments added to code, and no em-dash characters anywhere
- [ ] No `any`, no non-null assertions
- [ ] External input is parsed with a Zod schema from `@orbit/shared`
- [ ] Authorization is enforced on the server through `packages/shared/src/policy`, not only in the UI
- [ ] Docs updated if behaviour, configuration or setup changed
- [ ] Schema changes use ordered migrations and have upgrade evidence. Do not use `db:push` for production deployment.

## Anything reviewers should know

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. Flagging your own doubts speeds review up more than anything else. -->
