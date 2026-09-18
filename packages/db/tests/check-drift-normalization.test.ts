import { describe, expect, it } from 'bun:test';
import type { Catalog, CatalogCheck, CatalogIndex, CatalogTable } from '../src/check-drift.ts';
import { catalogDriftBetween, isBehind, needsCatchup } from '../src/check-drift.ts';

function tableWithIndex(index: CatalogIndex): CatalogTable {
  return {
    name: 'measurement',
    columns: [],
    primaryKey: [],
    indexes: [index],
    foreignKeys: [],
    checks: [],
  };
}

function catalogWithIndex(index: CatalogIndex): Catalog {
  return { tables: [tableWithIndex(index)], enums: [] };
}

function indexWithColumn(column: string): CatalogIndex {
  return {
    name: 'measurement_value_idx',
    unique: false,
    method: 'btree',
    columns: [column],
    predicate: '',
  };
}

describe('catalog index normalization', () => {
  for (const liveColumn of [
    'value::numeric(10,2)',
    'value::timestamp(3) with time zone',
    'value::numeric(10,2)[]',
  ]) {
    it(`ignores the PostgreSQL cast typmod in ${liveColumn}`, () => {
      const drift = catalogDriftBetween(
        catalogWithIndex(indexWithColumn('value')),
        catalogWithIndex(indexWithColumn(liveColumn)),
      );

      expect(drift.indexMismatches).toEqual([]);
    });
  }
});

function tableWithChecks(checks: CatalogCheck[]): CatalogTable {
  return {
    name: 'measurement',
    columns: [],
    primaryKey: [],
    indexes: [],
    foreignKeys: [],
    checks,
  };
}

function catalogWithChecks(checks: CatalogCheck[]): Catalog {
  return { tables: [tableWithChecks(checks)], enums: [] };
}

function checkWith(name: string, expression: string): CatalogCheck {
  return { name, expression };
}

const renderedCheckPairs: readonly (readonly [string, string])[] = [
  [
    '"github_check_activity"."source_kind" in (\'check_run\', \'commit_status\')',
    "CHECK (source_kind = ANY (ARRAY['check_run'::text, 'commit_status'::text]))",
  ],
  [
    '"github_check_head_context"."context_version" >= 0 and "github_check_head_context"."reconciliation_attempts" >= 0',
    'CHECK (context_version >= 0 AND reconciliation_attempts >= 0)',
  ],
  [
    '"notification_conversation"."event_count" >= 0\n        and "notification_conversation"."unread_event_count" >= 0\n        and "notification_conversation"."unread_mention_count" >= 0\n        and "notification_conversation"."unread_event_count" <= "notification_conversation"."event_count"\n        and "notification_conversation"."unread_mention_count" <= "notification_conversation"."unread_event_count"\n        and ("notification_conversation"."manual_unread" is false or "notification_conversation"."unread_event_count" = 0)',
    'CHECK (event_count >= 0 AND unread_event_count >= 0 AND unread_mention_count >= 0 AND unread_event_count <= event_count AND unread_mention_count <= unread_event_count AND (manual_unread IS FALSE OR unread_event_count = 0))',
  ],
  [
    'jsonb_typeof("github_pull_request_reconciliation"."conflicting_head_shas") = \'array\'',
    "CHECK (jsonb_typeof(conflicting_head_shas) = 'array'::text)",
  ],
  [
    '("github_check_activity"."webhook_delivery_id" is not null) <> ("github_check_activity"."reconciliation_fetch_id" is not null)',
    'CHECK ((webhook_delivery_id IS NOT NULL) <> (reconciliation_fetch_id IS NOT NULL))',
  ],
];

describe('catalog check normalization', () => {
  for (const [declared, rendered] of renderedCheckPairs) {
    it(`treats ${rendered.slice(0, 60)} as the declared expression`, () => {
      const drift = catalogDriftBetween(
        catalogWithChecks([checkWith('measurement_value_check', declared)]),
        catalogWithChecks([checkWith('measurement_value_check', rendered)]),
      );

      expect(drift.checkConstraintMismatches).toEqual([]);
      expect(isBehind(drift)).toBe(false);
    });
  }
});

describe('catalog check constraint comparison', () => {
  it('reports a declared check the database does not have', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('measurement_value_check', 'value >= 0')]),
      catalogWithChecks([]),
    );

    expect(drift.missingCheckConstraints).toEqual([
      { table: 'measurement', check: 'measurement_value_check' },
    ]);
    expect(isBehind(drift)).toBe(true);
  });

  it('accepts a check under a legacy name when the expression is unchanged', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('measurement_value_check', 'value >= 0')]),
      catalogWithChecks([checkWith('legacy_value_check', '"measurement"."value" >= 0')]),
    );

    expect(drift.missingCheckConstraints).toEqual([]);
    expect(drift.checkConstraintMismatches).toEqual([]);
    expect(drift.undeclaredCheckConstraints).toEqual([]);
    expect(isBehind(drift)).toBe(false);
  });

  it('reports a check whose expression changed under the same name', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('measurement_value_check', 'value >= 0')]),
      catalogWithChecks([checkWith('measurement_value_check', 'value >= 1')]),
    );

    expect(drift.checkConstraintMismatches.map((entry) => entry.name)).toEqual([
      'measurement_value_check',
    ]);
    expect(isBehind(drift)).toBe(true);
  });

  it('reports an undeclared check without treating it as behind', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([]),
      catalogWithChecks([checkWith('measurement_legacy_check', 'value >= 0')]),
    );

    expect(drift.undeclaredCheckConstraints).toEqual([
      { table: 'measurement', check: 'measurement_legacy_check' },
    ]);
    expect(isBehind(drift)).toBe(false);
  });
});

describe('catalog check literal handling', () => {
  it('keeps a literal that contains a qualifying dot', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('code_check', "detail = 'a.b'")]),
      catalogWithChecks([checkWith('code_check', "detail = 'b'")]),
    );

    expect(drift.checkConstraintMismatches.map((entry) => entry.name)).toEqual(['code_check']);
  });

  it('keeps a cast-looking suffix inside a literal', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('note_check', "note = '::text'")]),
      catalogWithChecks([checkWith('note_check', "CHECK ((note = '::text'::text))")]),
    );

    expect(drift.checkConstraintMismatches).toEqual([]);
    expect(drift.missingCheckConstraints).toEqual([]);
  });

  it('keeps parentheses inside a literal in an in-list', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('status_check', "status in ('ready)', 'pending')")]),
      catalogWithChecks([
        checkWith(
          'status_check',
          "CHECK ((status = ANY (ARRAY['ready)'::text, 'pending'::text])))",
        ),
      ]),
    );

    expect(drift.checkConstraintMismatches).toEqual([]);
  });
});

describe('catalog check grouping', () => {
  it('does not unify differently grouped conjunctions', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('flag_check', "(kind = 'a' or kind = 'b') and active")]),
      catalogWithChecks([
        checkWith('flag_check', "CHECK (kind = 'a'::text OR kind = 'b'::text AND active)"),
      ]),
    );

    expect(drift.checkConstraintMismatches.map((entry) => entry.name)).toEqual(['flag_check']);
  });

  it('accepts redundant parentheses around a conjunction', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([
        checkWith('flag_check', 'owner is null or (active is not null and enabled is not null)'),
      ]),
      catalogWithChecks([
        checkWith(
          'flag_check',
          'CHECK (owner IS NULL OR active IS NOT NULL AND enabled IS NOT NULL)',
        ),
      ]),
    );

    expect(drift.checkConstraintMismatches).toEqual([]);
    expect(drift.missingCheckConstraints).toEqual([]);
  });
});

describe('catalog check matching', () => {
  it('does not reuse a named check consumed by an expression match', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([
        checkWith('alpha_check', 'value >= 0'),
        checkWith('beta_check', 'value >= 0'),
      ]),
      catalogWithChecks([checkWith('beta_check', 'value >= 0')]),
    );

    expect(drift.missingCheckConstraints).toEqual([{ table: 'measurement', check: 'beta_check' }]);
    expect(isBehind(drift)).toBe(true);
  });

  it('classifies a missing check constraint as reconciliation work, not a catchup', () => {
    const drift = catalogDriftBetween(
      catalogWithChecks([checkWith('value_check', 'value >= 0')]),
      catalogWithChecks([]),
    );

    expect(isBehind(drift)).toBe(true);
    expect(needsCatchup(drift)).toBe(false);
  });
});
