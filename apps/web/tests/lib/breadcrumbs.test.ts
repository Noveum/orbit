import { describe, expect, test } from 'bun:test';
import { breadcrumbsFor } from '../../src/lib/breadcrumbs.ts';

describe('breadcrumbsFor', () => {
  test('a workspace-only path yields a single, non-navigable crumb', () => {
    expect(breadcrumbsFor('/', 'Noveum')).toEqual([{ label: 'Noveum' }]);
  });

  test('the workspace crumb links home and the current page does not link', () => {
    expect(breadcrumbsFor('/inbox', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Inbox' },
    ]);
  });

  test('a navigable ancestor links while the leaf stays plain text', () => {
    expect(breadcrumbsFor('/docs/new', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Docs', href: '/docs' },
      { label: 'New' },
    ]);
  });

  test('nested settings expose every navigable ancestor as a link', () => {
    expect(breadcrumbsFor('/settings/account/passkeys', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Settings', href: '/settings' },
      { label: 'Account', href: '/settings/account' },
      { label: 'Passkeys' },
    ]);
  });

  test('ancestors without their own page never become links', () => {
    expect(breadcrumbsFor('/team/eng/issues', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Team' },
      { label: 'Eng' },
      { label: 'Issues' },
    ]);
  });

  test('opaque id segments drop from labels but stay in ancestor hrefs', () => {
    expect(breadcrumbsFor('/docs/1b3f6c2e-0a4d-4e2f-9c1a-7d5e8f0a1b2c', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Docs' },
    ]);
  });

  test('an unrouted parent stays text even with a real leaf', () => {
    expect(breadcrumbsFor('/issue/ENG-123', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'Issue' },
      { label: 'ENG 123' },
    ]);
  });

  test('multi-word segments titleize on hyphen', () => {
    expect(breadcrumbsFor('/my-issues', 'Noveum')).toEqual([
      { label: 'Noveum', href: '/' },
      { label: 'My issues' },
    ]);
  });
});
