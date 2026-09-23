import { describe, expect, it } from 'bun:test';
import type { Catalog, CatalogIndex, CatalogTable } from '../src/check-drift.ts';
import { catalogDriftBetween } from '../src/check-drift.ts';

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

function catalogWithCheck(expression: string): Catalog {
  return {
    tables: [
      {
        ...tableWithIndex(indexWithColumn('value')),
        checks: [{ name: 'check_value', expression }],
      },
    ],
    enums: [],
  };
}

describe('catalog CHECK normalization', () => {
  it('keeps casts that can change a CHECK result', () => {
    const drift = catalogDriftBetween(
      catalogWithCheck('value::integer > 0'),
      catalogWithCheck('value::numeric > 0'),
    );
    expect(drift.checkMismatches).toHaveLength(1);
  });

  it('accepts redundant parentheses without losing boolean precedence', () => {
    const drift = catalogDriftBetween(
      catalogWithCheck('(a is null and b is not null) or (a is not null and b is null)'),
      catalogWithCheck('(((a IS NULL) AND (b IS NOT NULL)) OR ((a IS NOT NULL) AND (b IS NULL)))'),
    );
    expect(drift.checkMismatches).toEqual([]);
  });

  it('accepts PostgreSQL text casts on string literals', () => {
    const drift = catalogDriftBetween(
      catalogWithCheck("revoke_reason = 'agent_identity_required'"),
      catalogWithCheck("revoke_reason = 'agent_identity_required'::text"),
    );
    expect(drift.checkMismatches).toEqual([]);
  });
});

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
