import { describe, expect, it } from 'bun:test';
import { emailDomain, normalizeDomains, parseDomainList } from '../../src/utils/email-domain.ts';

describe('emailDomain', () => {
  it('takes the part after the last at sign, lowercased', () => {
    expect(emailDomain('Person@Example.COM')).toBe('example.com');
    expect(emailDomain('odd@name@example.com')).toBe('example.com');
  });

  it('returns null when there is no domain to read', () => {
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain('trailing@')).toBeNull();
    expect(emailDomain('')).toBeNull();
  });
});

describe('normalizeDomains', () => {
  it('trims, lowercases and drops a leading at sign', () => {
    expect(normalizeDomains([' @Example.com ', 'ORBIT.test'])).toEqual([
      'example.com',
      'orbit.test',
    ]);
  });

  it('drops entries that are empty once trimmed', () => {
    expect(normalizeDomains(['', '  ', 'example.com'])).toEqual(['example.com']);
  });
});

describe('parseDomainList', () => {
  it('reads a comma separated list', () => {
    expect(parseDomainList('example.com, @orbit.test')).toEqual(['example.com', 'orbit.test']);
  });

  it('treats unset, empty and separator only values as no restriction', () => {
    expect(parseDomainList(undefined)).toEqual([]);
    expect(parseDomainList('')).toEqual([]);
    expect(parseDomainList('  ')).toEqual([]);
    expect(parseDomainList(',,')).toEqual([]);
  });
});
