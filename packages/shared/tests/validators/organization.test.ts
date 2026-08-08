import { describe, expect, it } from 'bun:test';
import { organizationDeleteSchema } from '../../src/validators/organization.ts';

describe('organizationDeleteSchema', () => {
  it('trims the exact workspace-name confirmation', () => {
    expect(organizationDeleteSchema.parse({ confirmation: '  Nova  ' })).toEqual({
      confirmation: 'Nova',
    });
  });

  it('rejects empty and oversized confirmations', () => {
    expect(organizationDeleteSchema.safeParse({ confirmation: '   ' }).success).toBe(false);
    expect(organizationDeleteSchema.safeParse({ confirmation: 'n'.repeat(65) }).success).toBe(
      false,
    );
  });

  it('rejects organization selectors outside the confirmation contract', () => {
    expect(
      organizationDeleteSchema.safeParse({ confirmation: 'Nova', organizationId: 'org_2' }).success,
    ).toBe(false);
  });
});
