import { describe, expect, it } from 'bun:test';
import {
  NOVEUM_IMPORT_ORGANIZATION_ID,
  NOVEUM_SEED_ORGANIZATION_ID,
  noveumOrganizationValues,
} from '../src/noveum-workspace.ts';

describe('noveumOrganizationValues', () => {
  it('allows the exact Noveum and Yodu email domains in every Noveum workspace', () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');

    for (const id of [NOVEUM_IMPORT_ORGANIZATION_ID, NOVEUM_SEED_ORGANIZATION_ID]) {
      expect(noveumOrganizationValues(id, createdAt)).toEqual({
        id,
        name: 'Noveum',
        slug: 'noveum',
        logo: null,
        allowedEmailDomains: ['noveum.ai', 'yodu.ai'],
        createdAt,
      });
    }
  });
});
