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
- Registry entries added or updated, including HTTPS links, exact evidence kinds, and release identities:
- Implementation evidence (`implementation:record:<key>`):
- Failing test (`test:record:<key>`) or approved non-behavioral evidence (`test-na:record:<key>;justification=record:<key>;approver=principal:<key>`):
- Release-gate evidence (`gate:record:<key>`):
- Documentation evidence (`docs:record:<key>`):
- Residual-risk record (`risk:record:<key>`):
- Decision record (`decision:record:<key>;implementation=principal:<key>;finding=principal:<key>;approver=principal:<key>`):
- Independent Release approver (`approver:principal:<key>`):
- Security authority (`authority:principal:<key>`) or `not-required`:
- P1 exception expiry, mitigation evidence, and substantive public limitation:

## Screenshots

<!-- Anything visual needs a before and after. Both themes if you touched styling. Delete this section if the change is not visual. -->

## Checklist

- [ ] `bun run verify` is green
- [ ] Tests added or updated, and they fail without the change
- [ ] Every closure field uses its ledger structured reference format and resolves through the registry.
- [ ] A behavior-change closure links a failing test added first. Non-behavioral work has the approved structured `test-na` record.
- [ ] Test and release-gate records attest selected release commit `808d714`; historical audit records appear only as risk evidence.
- [ ] Terminal owner, decision, approval, and authority principals resolve to HTTPS human assignment records with stable subject identifiers.
- [ ] The registered owner role matches the ledger, and the implementation, finding-owner, and Release-approver subjects are distinct.
- [ ] Security-required findings use an independent subject with the exact `Security maintainer` role without publishing private details.
- [ ] A P1 exception has a future expiry and matches its finding's owner, risk, decision, approver, and authority records.
- [ ] No comments added to code, and no em-dash characters anywhere
- [ ] No `any`, no non-null assertions
- [ ] External input is parsed with a Zod schema from `@orbit/shared`
- [ ] Authorization is enforced on the server through `packages/shared/src/policy`, not only in the UI
- [ ] Docs updated if behaviour, configuration or setup changed
- [ ] Schema changes use ordered migrations and have upgrade evidence. Do not use `db:push` for production deployment.

## Anything reviewers should know

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. Flagging your own doubts speeds review up more than anything else. -->
