import { describe, expect, it } from 'bun:test';
import type { Catalog, CatalogFunction, CatalogTrigger } from '../src/check-drift.ts';
import { catalogDriftBetween, expectedCatalog, isBehind } from '../src/check-drift.ts';

function catalogWithRoutines(
  functions: readonly CatalogFunction[],
  triggers: readonly CatalogTrigger[],
): Catalog {
  return { tables: [], enums: [], functions, triggers };
}

describe('catalog lifecycle routines', () => {
  it('declares every Phase 2 lifecycle function and trigger', () => {
    const catalog = expectedCatalog({});

    expect(catalog.functions?.map((entry) => entry.name)).toEqual([
      'agent_identity_lifecycle_guard',
      'mcp_grant_lifecycle_guard',
    ]);
    expect(catalog.triggers?.map((entry) => entry.name)).toEqual([
      'agent_identity_active_grant_guard_trigger',
      'agent_identity_lifecycle_guard_trigger',
      'mcp_grant_lifecycle_guard_trigger',
    ]);
  });

  it('detects missing and changed lifecycle routines', () => {
    const expected = expectedCatalog({});
    const expectedFunctions = expected.functions ?? [];
    const expectedTriggers = expected.triggers ?? [];
    const liveFunctions = expectedFunctions.map((entry) =>
      entry.name === 'mcp_grant_lifecycle_guard'
        ? { ...entry, definition: `${entry.definition} altered` }
        : entry,
    );
    const liveTriggers = expectedTriggers
      .filter((entry) => entry.name !== 'agent_identity_active_grant_guard_trigger')
      .map((entry) =>
        entry.name === 'mcp_grant_lifecycle_guard_trigger' ? { ...entry, enabled: 'D' } : entry,
      );

    const drift = catalogDriftBetween(
      catalogWithRoutines(expectedFunctions, expectedTriggers),
      catalogWithRoutines(liveFunctions, liveTriggers),
    );

    expect(drift.functionMismatches.map((entry) => entry.name)).toEqual([
      'mcp_grant_lifecycle_guard()',
    ]);
    expect(drift.missingTriggers).toContainEqual({
      table: 'agent_identity',
      trigger: 'agent_identity_active_grant_guard_trigger',
    });
    expect(drift.triggerMismatches.map((entry) => entry.name)).toEqual([
      'mcp_grant_lifecycle_guard_trigger',
    ]);
    expect(isBehind(drift)).toBe(true);
  });

  it('reports undeclared routines without blocking a compatible catalog', () => {
    const expected = catalogWithRoutines([], []);
    const liveFunction: CatalogFunction = {
      name: 'legacy_helper',
      identityArguments: '',
      returnType: 'trigger',
      language: 'plpgsql',
      definition: 'BEGIN RETURN NULL; END;',
    };
    const liveTrigger: CatalogTrigger = {
      table: 'legacy_sidecar',
      name: 'legacy_helper_trigger',
      definition:
        'CREATE TRIGGER legacy_helper_trigger AFTER INSERT ON legacy_sidecar FOR EACH ROW EXECUTE FUNCTION legacy_helper()',
      enabled: 'O',
    };

    const drift = catalogDriftBetween(expected, catalogWithRoutines([liveFunction], [liveTrigger]));

    expect(drift.undeclaredFunctions).toEqual(['legacy_helper()']);
    expect(drift.undeclaredTriggers).toEqual([
      { table: 'legacy_sidecar', trigger: 'legacy_helper_trigger' },
    ]);
    expect(isBehind(drift)).toBe(false);
  });
});
