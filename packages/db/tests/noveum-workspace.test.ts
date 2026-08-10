import { describe, expect, it } from 'bun:test';
import {
  NOVEUM_IMPORT_ORGANIZATION_ID,
  noveumOrganizationValues,
} from '../src/noveum-workspace.ts';

describe('noveumOrganizationValues', () => {
  it('allows the exact Noveum and Yodu email domains for the legacy import workspace', () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');

    expect(noveumOrganizationValues(NOVEUM_IMPORT_ORGANIZATION_ID, createdAt)).toEqual({
      id: NOVEUM_IMPORT_ORGANIZATION_ID,
      name: 'Noveum',
      slug: 'noveum',
      logo: null,
      allowedEmailDomains: ['noveum.ai', 'yodu.ai'],
      createdAt,
    });
  });
});
