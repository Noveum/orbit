import { describe, expect, it } from 'bun:test';
import {
  overridesOf,
  parseLock,
  requirementsOf,
  resolutionsOf,
  splitSpecifier,
  stripTrailingCommas,
  violations,
} from '../../../scripts/check-dependency-dedupe.ts';

const satisfies = (version: string, range: string): boolean => Bun.semver.satisfies(version, range);

const splitLock = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "orbit", "devDependencies": { "typescript": "5.9.3", }, },
    "apps/web": { "name": "@orbit/web", "dependencies": { "@codemirror/view": "^6.43.7", }, "peerDependencies": { "@codemirror/state": "^6.7.0", }, },
  },
  "packages": {
    "@codemirror/commands": ["@codemirror/commands@6.10.4", "", { "dependencies": { "@codemirror/view": "^6.27.0" } }, "sha512-a"],
    "some-cm-plugin": ["some-cm-plugin@1.0.0", "", { "peerDependencies": { "@codemirror/view": "^6.40.0" }, "optionalPeers": [] }, "sha512-p"],
    "@codemirror/view": ["@codemirror/view@6.43.7", "", { "dependencies": { "@codemirror/state": "^6.7.0" } }, "sha512-b"],
    "@codemirror/commands/@codemirror/view": ["@codemirror/view@6.43.6", "", { "dependencies": { "@codemirror/state": "^6.7.0" } }, "sha512-c"],
    "@orbit/web": ["@orbit/web@workspace:apps/web"],
  }
}`;

describe('stripTrailingCommas', () => {
  it('makes the lockfile bun writes parseable as JSON', () => {
    expect(() => JSON.parse(splitLock)).toThrow();
    expect(() => JSON.parse(stripTrailingCommas(splitLock))).not.toThrow();
  });

  it('leaves a comma that a string legitimately contains', () => {
    const parsed: unknown = JSON.parse(stripTrailingCommas('{ "a": "one, ]", "b": [1, 2,], }'));
    expect(parsed).toEqual({ a: 'one, ]', b: [1, 2] });
  });

  it('does not let an escaped quote end the string it is inside', () => {
    const parsed: unknown = JSON.parse(stripTrailingCommas('{ "a": "x\\",]" }'));
    expect(parsed).toEqual({ a: 'x",]' });
  });
});

describe('splitSpecifier', () => {
  it('keeps the scope out of the version', () => {
    expect(splitSpecifier('@codemirror/view@6.43.8')).toEqual({
      name: '@codemirror/view',
      version: '6.43.8',
    });
  });

  it('handles an unscoped name', () => {
    expect(splitSpecifier('crelt@1.0.6')).toEqual({ name: 'crelt', version: '1.0.6' });
  });

  it('reports a specifier with no version', () => {
    expect(splitSpecifier('crelt')).toBeNull();
  });
});

describe('resolutionsOf', () => {
  it('finds the nested copy a partial bump leaves behind', () => {
    const found = resolutionsOf(parseLock(splitLock), '@codemirror/view');
    expect(found).toEqual([
      { holder: '@codemirror/view', version: '6.43.7' },
      { holder: '@codemirror/commands/@codemirror/view', version: '6.43.6' },
    ]);
  });

  it('does not confuse a package with one whose name it ends with', () => {
    expect(resolutionsOf(parseLock(splitLock), 'view')).toEqual([]);
  });
});

describe('requirementsOf', () => {
  it('collects what workspaces and packages ask for', () => {
    expect(requirementsOf(parseLock(splitLock), '@codemirror/view')).toEqual([
      { source: 'apps/web/package.json', range: '^6.43.7' },
      { source: '@codemirror/commands', range: '^6.27.0' },
      { source: 'some-cm-plugin (peer)', range: '^6.40.0' },
    ]);
  });

  it('does not let a peer range escape the check', () => {
    expect(requirementsOf(parseLock(splitLock), '@codemirror/state')).toEqual([
      { source: 'apps/web/package.json (peer)', range: '^6.7.0' },
      { source: '@codemirror/view', range: '^6.7.0' },
      { source: '@codemirror/commands/@codemirror/view', range: '^6.7.0' },
    ]);
  });
});

describe('violations', () => {
  const single = [{ holder: '@codemirror/view', version: '6.43.8' }];

  it('reports the split that fails typecheck', () => {
    const found = violations(
      '@codemirror/view',
      '^6.43.6',
      [
        { holder: '@codemirror/view', version: '6.43.7' },
        { holder: '@codemirror/commands/@codemirror/view', version: '6.43.6' },
      ],
      [],
      satisfies,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('resolves to 2 versions (6.43.6, 6.43.7)');
  });

  it('passes one copy that everyone can live with', () => {
    expect(
      violations(
        '@codemirror/view',
        '^6.43.6',
        single,
        [
          { source: 'apps/web/package.json', range: '^6.43.7' },
          { source: '@codemirror/commands', range: '^6.27.0' },
        ],
        satisfies,
      ),
    ).toEqual([]);
  });

  it('catches the bump an override silently swallows', () => {
    const found = violations(
      '@codemirror/view',
      '^6.43.6',
      single,
      [{ source: 'apps/web/package.json', range: '^6.44.0' }],
      satisfies,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("apps/web/package.json asks for '^6.44.0'");
    expect(found[0]).toContain('installs 6.43.8');
  });

  it('catches an override that outranks what a dependency needs', () => {
    const found = violations(
      '@codemirror/view',
      '^6.43.6',
      [{ holder: '@codemirror/view', version: '6.43.8' }],
      [{ source: '@codemirror/lint', range: '^6.44.0' }],
      satisfies,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('@codemirror/lint');
  });

  it('reports an override for something nothing depends on', () => {
    const found = violations('@codemirror/gone', '^1.0.0', [], [], satisfies);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('nothing in bun.lock depends on it');
  });
});

describe('overridesOf', () => {
  it('reads the overrides block', () => {
    expect(overridesOf({ overrides: { '@codemirror/view': '^6.43.6' } })).toEqual(
      new Map([['@codemirror/view', '^6.43.6']]),
    );
  });

  it('is empty when there is no overrides block', () => {
    expect(overridesOf({ devDependencies: { typescript: '5.9.3' } })).toEqual(new Map());
  });
});
