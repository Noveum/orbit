# Task 12 report

## Outcome

The analytics route now renders a useful, zero-configuration planning cockpit from the one hydrated active-lens response. It no longer shows the Task 11 status placeholder or starts the legacy aggregate tree.

The cockpit provides semantic Overview, Sprints, Projects, and People tabs, a sticky compact toolbar, reporting range presets, validated custom dates, comparison and measure selection, archived and canceled toggles, clean URL persistence, and reset. Tabs support Arrow Left, Arrow Right, Home, and End. Narrow layouts scroll tabs and metric cards horizontally.

Hydrated data is visible immediately. Overview shows its metric strip and planning pulse. Sprints shows current scope and a burn preview or an honest first-sprint state. Projects shows portfolio progress and risk. People gives the current user a prominent My work panel when the service resolves a focus and keeps the workspace people table visible.

## RED

`bun test tests/features/analytics/analytics-cockpit.test.tsx` failed because `analytics-cockpit.tsx` did not exist.

The new tests require useful hydrated metrics, keyboard tab navigation, URL updates, custom range validation, reset behavior, and the first-sprint state.

## GREEN

- Focused cockpit, page, and skeleton tests: 6 passed, 0 failed.
- Full `@orbit/web` suite on `analytics-cockpit-task12`: 1,994 passed, 0 failed, 4,947 assertions.
- `@orbit/web` typecheck: passed.
- Repository lint, comment policy, byte policy, Bun import policy, and dependency policy: passed, apart from the existing Biome schema information and existing source-byte fixture warning.
- Production web build against the isolated current-schema web test database: passed, 103 pages generated, standalone bundle emitted.

## Review correction

Task 11 temporarily replaced the legacy page with a data-ready message. Task 12 removes that boundary and consumes the hydrated lens result directly. The initial route performs one active-lens aggregate load and that result is the content users see.
