<!-- Thanks for contributing. Keep this short. The parts reviewers actually read are what changed and how you know it works. -->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link the issue: Closes #123 -->

Closes #

## How you know it works

<!-- The test you added, the manual check you ran, or both. "A feature is not done until it has a test that would fail if the feature broke." -->

## Readiness finding closure

<!-- Complete this section only when the pull request claims to close a finding in docs/maintainers/readiness-ledger.md. Do not include undisclosed vulnerability details. Use a private GitHub Security Advisory for those details. -->

- Finding ID:
- Failing test or pre-change evidence:
- Passing release gate on the selected release commit:
- Ledger update:
- Residual risk:
- P1 exception owner, expiry, mitigation, and public limitation, if applicable:

## Screenshots

<!-- Anything visual needs a before and after. Both themes if you touched styling. Delete this section if the change is not visual. -->

## Checklist

- [ ] `bun run verify` is green
- [ ] Tests added or updated, and they fail without the change
- [ ] A finding-closure claim links the finding ID, failing test or pre-change evidence, passing release gate, ledger update, and residual risk
- [ ] Any P1 exception names its owner, expiry, mitigation, public limitation, and residual risk
- [ ] No comments added to code, and no em-dash characters anywhere
- [ ] No `any`, no non-null assertions
- [ ] External input is parsed with a Zod schema from `@orbit/shared`
- [ ] Authorization is enforced on the server through `packages/shared/src/policy`, not only in the UI
- [ ] Docs updated if behaviour, configuration or setup changed
- [ ] Schema changes use ordered migrations and have upgrade evidence. Do not use `db:push` for production deployment.

## Anything reviewers should know

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. Flagging your own doubts speeds review up more than anything else. -->
