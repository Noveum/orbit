import { describe, expect, it } from 'bun:test';
import {
  organizationDeleteSchema,
  organizationDeletionResponseSchema,
  organizationDeletionSummaryResponseSchema,
} from '../../src/validators/organization.ts';

describe('organizationDeleteSchema', () => {
  it('rejects surrounding spaces instead of changing the exact confirmation', () => {
    expect(organizationDeleteSchema.safeParse({ confirmation: '  Nova  ' }).success).toBe(false);
    expect(organizationDeleteSchema.parse({ confirmation: 'Nova' })).toEqual({
      confirmation: 'Nova',
    });
  });

  it('accepts the longest creatable name and rejects anything larger', () => {
    expect(organizationDeleteSchema.safeParse({ confirmation: '   ' }).success).toBe(false);
    expect(organizationDeleteSchema.safeParse({ confirmation: 'n'.repeat(80) }).success).toBe(true);
    expect(organizationDeleteSchema.safeParse({ confirmation: 'n'.repeat(81) }).success).toBe(
      false,
    );
  });

  it('rejects organization selectors outside the confirmation contract', () => {
    expect(
      organizationDeleteSchema.safeParse({ confirmation: 'Nova', organizationId: 'org_2' }).success,
    ).toBe(false);
  });
});

describe('organization deletion response schemas', () => {
  it('parses the complete deletion inventory returned by the API', () => {
    expect(
      organizationDeletionSummaryResponseSchema.parse({
        summary: {
          organizationName: 'Nova',
          members: 4,
          teams: 3,
          projects: 2,
          issues: 17,
          documents: 5,
          files: 8,
          fileBytes: 4096,
          fileVersions: 12,
          fileVersionBytes: 6144,
          integrations: 1,
          webhooks: 2,
          availableAt: null,
          deletionRequestedAt: '2026-08-08T12:00:00.000Z',
        },
      }).summary.organizationName,
    ).toBe('Nova');
  });

  it('rejects malformed deletion results and extra selectors', () => {
    expect(
      organizationDeletionResponseSchema.safeParse({
        deletedOrganizationId: 'org_1',
        nextOrganizationId: null,
      }).success,
    ).toBe(true);
    expect(
      organizationDeletionResponseSchema.safeParse({
        deletedOrganizationId: 'org_1',
        nextOrganizationId: null,
        organizationId: 'org_2',
      }).success,
    ).toBe(false);
  });
});
