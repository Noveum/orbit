# Task 15 report

## Outcome

The Projects and People lenses now render the planning contracts inside the shared Analytics cockpit. Project and person selection update canonical URL focus state, so a focused view can be revisited without leaving Analytics.

Projects provides a bounded portfolio table with issue or point progress, health, target and milestone context, risk sorting, focused scope and progress, blocked, overdue, and stale evidence, delivery history, milestone evidence, estimate coverage, and recent project health updates.

People defaults to the current user and supports selecting any visible workspace person. It shows current assignments, completed work, average throughput per active week, work in progress, cycle time, lead time, WIP age, historical attribution coverage, assignment and completion activity, project, state, milestone, and sprint breakdowns, and a personal current and previous sprint burn based on historical assignment facts. Former, deleted, and unassigned identities remain usable. The lens presents work facts without a productivity score or ranking.

## RED

- Project and People component tests initially failed because the lens modules did not exist.
- Personal sprint burn coverage failed because the People lens did not consume the shared sprint-burn selection.
- Project health update coverage failed because focused project updates were not rendered.
- URL focus coverage failed until table selection was wired through the shared Analytics query state.

## GREEN

- Focused Projects, People, and cockpit tests: 13 passed, 0 failed, 69 assertions before the final URL selection extension.
- Final cockpit tests: 12 passed, 0 failed, 50 assertions.
- Full `@orbit/web` suite on `analytics-cockpit-task15`: 2,022 passed, 0 failed, 5,070 assertions across 255 files.
- `@orbit/web` and monorepo typechecks passed.
- Repository lint, comment policy, source-byte policy, shipped Bun import policy, dependency policy, and diff checks passed. Lint retained only the existing Biome schema information and existing database test warning.

## Formulas

- Current assignments are open work assigned at the reporting time.
- Completed work is attributed at completion using captured close facts, reconstructed assignment history, then current assignment only when historical evidence is unavailable.
- Average throughput divides completed work by active weeks containing assignment or completion evidence.
- Cycle time is start to completion.
- Lead time is creation to completion.
- WIP age is time in the current working state.
- Unestimated work contributes zero points and remains disclosed.

## Scope boundary

Saved analytics views, exact evidence CSV, aggregate realtime invalidation, final end-to-end coverage, performance checks, and review screenshots remain in the final delivery tasks.
