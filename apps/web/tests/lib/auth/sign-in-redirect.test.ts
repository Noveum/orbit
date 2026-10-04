import { describe, expect, it } from 'bun:test';
import { signInRedirect } from '../../../src/lib/auth/sign-in-redirect.ts';

function nextOf(target: string | null): string | null {
  return new URL(target ?? '', 'http://localhost:3000').searchParams.get('next');
}

describe('signInRedirect', () => {
  it('lets a request that carries a session cookie through', () => {
    expect(signInRedirect('/issue/ENG-1', '', true)).toBeNull();
    expect(signInRedirect('/projects/apollo', '?tab=x', true)).toBeNull();
  });

  it('sends a request without a session cookie to the login page with its path', () => {
    expect(signInRedirect('/issue/ENG-1', '', false)).toBe('/login?next=%2Fissue%2FENG-1');
    expect(signInRedirect('/projects/apollo/issues', '', false)).toBe(
      '/login?next=%2Fprojects%2Fapollo%2Fissues',
    );
  });

  it('keeps the whole query string inside the single next value', () => {
    const target = signInRedirect('/issue/ENG-1', '?comment=c_1&view=full', false);
    expect(target?.startsWith('/login?')).toBe(true);
    expect(nextOf(target)).toBe('/issue/ENG-1?comment=c_1&view=full');
    expect(new URL(target ?? '', 'http://localhost:3000').searchParams.has('view')).toBe(false);
  });
});
