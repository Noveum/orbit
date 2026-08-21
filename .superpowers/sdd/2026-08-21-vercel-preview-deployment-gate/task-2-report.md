# Task 2 report

## Outcome

Implemented the Vercel Preview deployment controller and its injected-runtime test suite. The controller reconciles eligible pull requests against exact live-main CI proof, changed-file relevance, and exact Vercel deployment identity before creating, polling, reusing, or canceling a Preview deployment.

The implementation includes endpoint-specific bounded pagination, stable workflow-run totals and unique IDs, final freshness checks, a one-POST ambiguity state machine, null-safe Preview and project identity, mutation response validation, cancellation-race handling, redirect rejection, token redaction, and a controller-wide 23-minute monotonic deadline.

## TDD evidence

The implementation was developed in focused red-green slices:

1. Event and eligibility tests were written before the controller existed. `bun test scripts/vercel-preview-deploy.test.ts --test-name-pattern 'event|eligibility|creates'` failed with the expected module-not-found error, with 0 passing tests and 1 loader failure. The completed slice then passed 19 tests.
2. Existing-deployment, idempotency, cancellation, and Vercel pagination cases were added next. The focused run failed 7 tests before the behavior was implemented, then passed.
3. Workflow-run and changed-file pagination, freshness, ambiguity recovery, polling, and deadline cases were added next. The focused run failed 14 tests before the behavior was implemented, then passed.
4. Mutation and detail identity validation plus secret-bearing URL rejection were added next. The focused run failed 4 tests before the behavior was implemented, then passed.
5. The final focused suite passes 81 tests with 182 assertions.

## Verification

- `bun test scripts/vercel-preview-deploy.test.ts`: 81 pass, 0 fail, 182 assertions.
- `bun x biome check scripts/vercel-preview-deploy.ts scripts/vercel-preview-deploy.test.ts`: passed.
- `bun x tsc -p scripts/tsconfig.json --noEmit`: passed.
- `bun run lint -- scripts/vercel-preview-deploy.ts scripts/vercel-preview-deploy.test.ts`: exited 0 with only pre-existing repository notices.
- `bun run check-comments`: passed.
- `bun run check-bytes`: passed.
- `bun run check-bun-imports`: passed.
- `git diff --check`: passed.
- `ORBIT_TEST_LANE=preview-gate-task2 bun run verify`: the lint, policy, dependency, typecheck, script-test, and core-test phases passed. Root script tests reported 106 pass and 0 fail. Core reported 974 pass and 0 fail. The realtime phase failed because the worktree has no `BETTER_AUTH_SECRET`. The unrelated web phase later stopped producing output and the already non-green run was interrupted after five minutes without progress.

## Concerns

There are no known Task 2 test, type, lint, policy, or byte-check failures. A fully green repository-wide verify requires the local realtime test secret and a non-stalling web suite. Live Vercel and GitHub API behavior remains a production canary concern for the workflow integration task.
