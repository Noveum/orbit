<!-- Thanks for contributing. Keep this short. The parts reviewers actually read are what changed and how you know it works. -->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link the issue: Closes #123 -->

Closes #

## How you know it works

<!-- The test you added, the manual check you ran, or both. "A feature is not done until it has a test that would fail if the feature broke." -->

## Readiness finding closure

<!-- Complete this section only when the pull request claims to close a finding in docs/maintainers/readiness-ledger.md. Do not include undisclosed vulnerability details. Use a private GitHub Security Advisory for those details. Terminal closure and P1 exception decisions require a linked access-controlled decision record and an independent Release maintainer approver. -->

- Finding ID:
- Failing test added first for each behavior change:
- Pre-change evidence, if applicable:
- Passing release gate on the selected release commit:
- Ledger update:
- Residual risk:
- Decision record:
- Independent Release maintainer approver:
- Security authority record for a security-sensitive finding, if applicable:
- Non-behavioral `N/A` justification and independent Release maintainer approval, if applicable:
- P1 exception owner, expiry, mitigation, public limitation, residual risk, decision record, independent approver, and security authority record where required:

## Screenshots

<!-- Anything visual needs a before and after. Both themes if you touched styling. Delete this section if the change is not visual. -->

## Checklist

- [ ] `bun run verify` is green
- [ ] Tests added or updated, and they fail without the change
- [ ] A behavior-change closure links a failing test added first. `N/A` is used only for demonstrably non-behavioral work with written justification and independent Release maintainer approval.
- [ ] A finding-closure claim links the finding ID, passing release gate, ledger update, residual risk, decision record, and an independent Release maintainer approver distinct from the implementation and finding owner.
- [ ] A security-sensitive finding closure links the appropriate security authority record without publishing private details.
- [ ] Any P1 exception names its owner, expiry, mitigation, public limitation, residual risk, decision record, independent approver, and security authority record where required.
- [ ] No comments added to code, and no em-dash characters anywhere
- [ ] No `any`, no non-null assertions
- [ ] External input is parsed with a Zod schema from `@orbit/shared`
- [ ] Authorization is enforced on the server through `packages/shared/src/policy`, not only in the UI
- [ ] Docs updated if behaviour, configuration or setup changed
- [ ] Schema changes use ordered migrations and have upgrade evidence. Do not use `db:push` for production deployment.

## Anything reviewers should know

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. Flagging your own doubts speeds review up more than anything else. -->
