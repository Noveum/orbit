import { describe, expect, it } from 'bun:test';
import { hasTestScript, packageName, summarise } from '../../../scripts/run-tests.ts';

describe('choosing which packages to test', () => {
  it('takes a package that declares a test script', () => {
    expect(hasTestScript({ name: '@orbit/core', scripts: { test: 'bun test' } })).toBe(true);
  });

  it('skips a package with no test script', () => {
    expect(hasTestScript({ name: '@orbit/ui', scripts: { build: 'tsc' } })).toBe(false);
  });

  it('skips a package with no scripts at all', () => {
    expect(hasTestScript({ name: '@orbit/ui' })).toBe(false);
  });

  it('treats an unreadable manifest as untestable rather than throwing', () => {
    expect(hasTestScript(null)).toBe(false);
    expect(hasTestScript('not a manifest')).toBe(false);
  });

  it('does not mistake a non-string test entry for a script', () => {
    expect(hasTestScript({ scripts: { test: true } })).toBe(false);
  });
});

describe('naming a package', () => {
  it('uses the declared name', () => {
    expect(packageName({ name: '@orbit/web' }, 'apps/web')).toBe('@orbit/web');
  });

  it('falls back to the directory when the manifest has no usable name', () => {
    expect(packageName({}, 'apps/web')).toBe('apps/web');
    expect(packageName({ name: '' }, 'apps/web')).toBe('apps/web');
    expect(packageName(null, 'apps/web')).toBe('apps/web');
  });
});

describe('reporting the run', () => {
  it('reports success without naming packages', () => {
    expect(summarise([], 9)).toBe('9 packages passed');
  });

  it('names every package that failed, which is what a red build needs to say', () => {
    expect(summarise(['@orbit/web', '@orbit/core'], 9)).toBe(
      '2 of 9 packages failed: @orbit/web, @orbit/core',
    );
  });
});
