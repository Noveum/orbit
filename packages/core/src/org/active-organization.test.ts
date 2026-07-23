import { describe, expect, it } from 'vitest';
import { selectActiveMembership } from './active-organization.ts';

const oldest = { organizationId: 'org_alpha', createdAt: new Date('2024-01-01T00:00:00.000Z') };
const middle = { organizationId: 'org_beta', createdAt: new Date('2024-06-01T00:00:00.000Z') };
const newest = { organizationId: 'org_gamma', createdAt: new Date('2025-01-01T00:00:00.000Z') };

describe('selectActiveMembership', () => {
  it('returns the stated active organization when the user is a member of it', () => {
    expect(selectActiveMembership([oldest, middle, newest], 'org_gamma')).toBe(newest);
    expect(selectActiveMembership([newest, middle, oldest], 'org_beta')).toBe(middle);
  });

  it('falls back to the oldest membership when no organization is stated', () => {
    expect(selectActiveMembership([newest, middle, oldest], null)).toBe(oldest);
    expect(selectActiveMembership([middle, oldest, newest], null)).toBe(oldest);
  });

  it('falls back to the oldest membership when the stated organization is not a membership', () => {
    expect(selectActiveMembership([newest, middle, oldest], 'org_unknown')).toBe(oldest);
  });

  it('breaks ties on identical timestamps by organization id', () => {
    const sameInstant = new Date('2024-03-03T00:00:00.000Z');
    const first = { organizationId: 'org_aaa', createdAt: sameInstant };
    const second = { organizationId: 'org_bbb', createdAt: sameInstant };
    expect(selectActiveMembership([second, first], null)).toBe(first);
    expect(selectActiveMembership([first, second], null)).toBe(first);
  });

  it('is stable across repeated calls whatever the row order', () => {
    const rows = [middle, newest, oldest];
    const results = Array.from({ length: 20 }, (_, attempt) =>
      selectActiveMembership(attempt % 2 === 0 ? rows : [...rows].reverse(), null),
    );
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(oldest);
  });

  it('returns undefined when the user has no memberships', () => {
    expect(selectActiveMembership([], null)).toBeUndefined();
    expect(selectActiveMembership([], 'org_alpha')).toBeUndefined();
  });

  it('does not mutate the input order', () => {
    const rows = [newest, middle, oldest];
    selectActiveMembership(rows, null);
    expect(rows).toEqual([newest, middle, oldest]);
  });
});
