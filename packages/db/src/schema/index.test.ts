import { describe, expect, it } from 'bun:test';
import { SYNC_MODELS } from '@orbit/shared/events';
import { getTableColumns, type Table } from 'drizzle-orm';
import * as schema from './index.ts';

function tableExportName(model: string): string {
  return model.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

describe('sync schema', () => {
  it('exposes a sync id column for every synced model', () => {
    const tables = schema as unknown as Record<string, Table | undefined>;
    for (const model of SYNC_MODELS) {
      const table = tables[tableExportName(model)];
      expect(table, model).toBeDefined();
      expect(Object.keys(getTableColumns(table as Table)), model).toContain('syncId');
    }
  });
});
