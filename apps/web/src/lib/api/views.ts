import type { ViewRow } from '@orbit/core';

export interface ViewPayload {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly filter: Record<string, unknown>;
  readonly layout: string;
  readonly groupBy: string;
  readonly shared: boolean;
  readonly createdAt: string;
}

export function toViewPayload(row: ViewRow): ViewPayload {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    filter: row.filter,
    layout: row.layout,
    groupBy: row.groupBy,
    shared: row.shared === 'true',
    createdAt: row.createdAt.toISOString(),
  };
}
