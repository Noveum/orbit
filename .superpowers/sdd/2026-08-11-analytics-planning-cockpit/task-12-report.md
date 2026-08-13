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

## Review round 1

The fresh review confirmed that the placeholder regression was closed and found five display-contract gaps. RED tests showed that Project and People rows stayed in issue units in points mode, Overview omitted every delivery bucket except the last, copied advanced filters were invisible, explicit person focus was labeled My work, and tabs had no associated panel.

The corrected cockpit uses the selected measure for Project and People values, sums created and completed delivery activity while keeping open as the final bucket state, renders active filter chips with removal controls, opens Orbit's shared searchable issue filter builder, uses Selected person for explicit focus, and connects every tab to the active tabpanel with stable IDs.

Focused review tests pass 8 of 8 with 32 assertions. The full web suite passes 1,998 of 1,998 with 4,962 assertions. Web typecheck and all static policy checks pass.

## Review round 2

The second review found that copied nested filter trees were visible but not safely editable, workspace state filters had no options, a sole assignee filter could label another person My work, and inactive tabs pointed to absent panels.

The toolbar now describes the complete operator, value, and negation for every condition, shows its All or Any nesting context, and edits or removes conditions by structural path without flattening the Boolean tree. Workspace analytics builds state options across every team. People uses Selected person for an explicit focus or a single assignee-constrained filter. Every tab now owns a persistent panel element while only the active panel renders data.

Focused review coverage passes 15 of 15 across cockpit and filter-field tests. The combined Task 12 and Task 13 foundation check passes 18 of 18 with 66 assertions, and web typecheck is green.

## Review round 3

The third review identified that flattened ancestry labels did not distinguish sibling Boolean groups with the same depth. Filters now render as nested fieldsets with explicit Match all or Match any legends, visible and accessible group boundaries, and conjunctions between siblings. A regression fixture distinguishes two sibling Match all groups inside one Match any root. Focused Task 12 tests pass 16 of 16 with 52 assertions and web typecheck is green.
