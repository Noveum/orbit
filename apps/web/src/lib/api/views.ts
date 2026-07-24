import type { ViewRecord } from '@orbit/core';
import type { ViewState } from '@orbit/shared/filters';

export interface ViewPayload {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly filter: ViewState;
  readonly layout: string;
  readonly groupBy: string;
  readonly shared: boolean;
  readonly virtual: boolean;
  readonly locked: boolean;
  readonly favorite: boolean;
  readonly createdAt: string;
}

export function toViewPayload(record: ViewRecord): ViewPayload {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    filter: record.state,
    layout: record.layout,
    groupBy: record.groupBy,
    shared: record.shared,
    virtual: record.virtual,
    locked: record.locked,
    favorite: record.favorite,
    createdAt: record.createdAt.toISOString(),
  };
}
