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
