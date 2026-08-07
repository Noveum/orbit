<!-- Thanks for contributing. Keep this short. The parts reviewers actually read are what changed and how you know it works. -->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link the issue: Closes #123 -->

Closes #

## How you know it works

<!-- The test you added, the manual check you ran, or both. "A feature is not done until it has a test that would fail if the feature broke." -->

## Screenshots

<!-- Anything visual needs a before and after. Both themes if you touched styling. Delete this section if the change is not visual. -->

## Checklist

- [ ] `bun run verify` is green, all four checks
- [ ] Tests added or updated, and they fail without the change
- [ ] No comments added to code, and no em-dash characters anywhere
- [ ] No `any`, no non-null assertions
- [ ] External input is parsed with a Zod schema from `@orbit/shared`
- [ ] Authorization is enforced on the server through `packages/shared/src/policy`, not only in the UI
- [ ] Docs updated if behaviour, configuration or setup changed
- [ ] Schema changes are pushed to the target database before this ships

## Anything reviewers should know

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. Flagging your own doubts speeds review up more than anything else. -->
