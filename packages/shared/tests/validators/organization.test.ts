import { describe, expect, it } from 'bun:test';
import { organizationDeleteSchema } from '../../src/validators/organization.ts';

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
