import { describe, expect, it } from 'bun:test';
import { db, sql } from '../../src/index.ts';

interface OrganizationForeignKey extends Record<string, unknown> {
  readonly tableName: string;
  readonly referencedTable: string | null;
  readonly deleteAction: string | null;
}

describe('organization deletion schema', () => {
  it('cascades every organization_id column from the organization table', async () => {
    const rows = await db.execute<OrganizationForeignKey>(sql`
      select
        child.relname as "tableName",
        parent.relname as "referencedTable",
        foreign_key.confdeltype::text as "deleteAction"
      from pg_class child
      inner join pg_namespace namespace on namespace.oid = child.relnamespace
      inner join pg_attribute organization_column
        on organization_column.attrelid = child.oid
        and organization_column.attname = 'organization_id'
        and not organization_column.attisdropped
      left join pg_constraint foreign_key
        on foreign_key.conrelid = child.oid
        and foreign_key.contype = 'f'
        and organization_column.attnum = any(foreign_key.conkey)
      left join pg_class parent on parent.oid = foreign_key.confrelid
      where namespace.nspname = 'public'
        and child.relkind = 'r'
      order by child.relname
    `);

    expect(rows.length).toBeGreaterThan(30);
    expect(
      rows.filter((row) => row.referencedTable !== 'organization' || row.deleteAction !== 'c'),
    ).toEqual([]);
  });
});
