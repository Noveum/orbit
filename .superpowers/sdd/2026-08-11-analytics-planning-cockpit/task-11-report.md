# Task 11 report

## Files changed

- `apps/web/src/features/analytics/contracts.ts`
- `apps/web/src/features/analytics/query-state.ts`
- `apps/web/src/features/analytics/use-analytics-query.ts`
- `apps/web/src/features/analytics/data.ts`
- `apps/web/src/app/api/analytics/overview/route.ts`
- `apps/web/src/app/api/analytics/sprints/route.ts`
- `apps/web/src/app/api/analytics/projects/route.ts`
- `apps/web/src/app/api/analytics/people/route.ts`
- `apps/web/src/app/api/analytics/drilldown/route.ts`
- `apps/web/src/app/(app)/analytics/page.tsx`
- `apps/web/src/lib/query/keys.ts`
- `apps/web/tests/features/analytics/contracts.test.ts`
- `apps/web/tests/features/analytics/query-state.test.ts`
- `apps/web/tests/features/analytics/use-analytics-query.test.tsx`
- `apps/web/tests/features/analytics/hydration.test.ts`
- `apps/web/tests/app/api/analytics/lenses.test.ts`

## RED

The canonical query-state test was written before the parser and serializer existed.

```text
Cannot find module '../../../src/features/analytics/query-state.ts'
0 pass
1 fail
1 error
```

The first route test was written before the overview route existed.

```text
Cannot find module '../../../../src/app/api/analytics/overview/route.ts'
0 pass
1 fail
1 error
```

The client query test first failed because `use-analytics-query.ts` did not exist. The hydration test first failed because `dehydratedAnalyticsLens` did not exist. A later malformed-filter regression expected a 422 response and initially received 500.

## GREEN

The focused Task 11 suite passed against isolated PostgreSQL:

```text
19 pass
0 fail
50 expect() calls
```

The tests cover default omission, advanced query-state round trips, malformed-state fallback, canonical keys, JSON-safe date boundaries, lens discrimination, abortable client fetches, provider stale reuse, active-lens-only hydration, all workspace roles, authentication, strict query errors, every lens response, principal My Work focus, organization isolation, signed cursor workspace binding, and cursor tamper rejection.

The complete web suite passed:

```text
1985 pass
0 fail
4895 expect() calls
245 files
```

Web typecheck, repository lint, comment policy, source-byte policy, Bun import policy, and diff whitespace checks passed.

## Data and URL semantics

- Each lens and drilldown route returns a schema-validated JSON-safe response. Server `Date` values become ISO strings before hydration, preventing server and client cache shape drift.
- The canonical serializer omits the entire zero-configuration state. It round trips custom dates, comparison and measure selections, nested filters, archive and canceled inclusion, project focus, and person focus.
- Invalid page URL state falls back atomically to the default. API URL state uses the strict parser and returns a validation response.
- Query keys expose one analytics root plus canonical lens and drilldown descendants.
- The client hook requests only the active lens, forwards the TanStack abort signal, and inherits the shared bounded retry and 30-second stale defaults.
- The server page resolves the clean URL, loads only the active lens, validates its wire response, and hydrates exactly one matching cache entry.
- A clean People request keeps focus absent from the URL while the service resolves My Work to the authenticated principal.
- The sprint adapter is a shared web service boundary suitable for both the analytics lens and later sprint-page consumers.
- Drilldown pagination retains the core signed cursor, request binding, workspace binding, tamper detection, and result cap.

## DONE

The production build was run with the current isolated test database after the drift guard correctly rejected the developer database's stale analytics schema.

```text
Drift guard: all declared tables and columns are present.
Next.js page generation: 103/103
Standalone bundle generated
```

The build emitted `/analytics` and all five analytics API routes. The feature branch and its worktree are preserved for the parent task.

## Review round 1

Four focused regressions drove the review fixes.

- A valid overview response sent to a People query initially passed the union response schema. The hook now selects the exact schema for the requested lens and exposes lens-specific overloads.
- Empty and future-only sprint workspaces initially threw `No sprint is available for analytics.` The core sprint service now returns a typed empty state with nullable selection and detail, zero flow, live coverage, and formula metadata. The web contract, route, and hydration boundary accept that state.
- The server page initially prefetched the new overview aggregate and also rendered the legacy analytics sections, starting duplicate database work. It now loads one active lens and renders a small client data boundary that consumes the hydrated cache. The legacy aggregate tree is deferred for the Task 12 cockpit replacement.
- Analytics canonicalization initially entered every consumer of the central query-key module. The analytics root, lens, and drilldown keys now live in `features/analytics/analytics-keys.ts`, leaving the global key module free of analytics runtime dependencies.

Review-focused results:

```text
Core sprint and people: 30 pass, 0 fail
Web data and page: 24 pass, 0 fail
```

Fresh full results after the review fixes:

```text
Core: 911 pass, 0 fail, 2519 expect() calls
Web: 1990 pass, 0 fail, 4928 expect() calls
```

Core and web typechecks, lint, comment policy, source-byte policy, Bun import policy, dependency policy, diff whitespace, and the production web build passed. The production build compiled, generated 103 pages, emitted the analytics page and routes, and generated the standalone bundle.
