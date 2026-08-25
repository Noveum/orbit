import { describe, expect, test } from 'bun:test';
import {
  collectCommitsInRange,
  datedTagsFromRefOutput,
  groupByArea,
  isMainReleasePR,
  isPublishedDatedRelease,
  renderNotes,
  selectDatedTag,
  selectReleaseBoundary,
} from '../scripts/release-notes';

const pr = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  title: 'Improve release workflow',
  html_url: 'https://github.com/Noveum/orbit/pull/1',
  body: null,
  labels: [],
  merged_at: '2026-08-21T00:00:00Z',
  base: { ref: 'main' },
  ...overrides,
});

describe('release notes grouping', () => {
  test('groups area labels and keeps unlabelled PRs in Other', () => {
    const result = groupByArea([
      pr({ number: 1, labels: [{ name: 'area:release' }] }),
      pr({ number: 2, labels: [] }),
    ]);

    expect(result.areas['area:release']?.map((item) => item.number)).toEqual([1]);
    expect(result.areas['Other']?.map((item) => item.number)).toEqual([2]);
    expect(result.breaking).toEqual([]);
  });

  test('accepts only PRs merged into main', () => {
    expect(isMainReleasePR(pr({ base: { ref: 'main' } }))).toBe(true);
    expect(isMainReleasePR(pr({ base: { ref: 'develop' } }))).toBe(false);
  });

  test('detects breaking changes from labels and body', () => {
    const result = groupByArea([
      pr({ number: 1, labels: [{ name: 'breaking change' }] }),
      pr({ number: 2, body: 'BREAKING CHANGE: update the API' }),
    ]);

    expect(result.breaking.map((item) => item.number)).toEqual([1, 2]);
  });
});

describe('release range pagination', () => {
  test('stops exactly at the base commit across pages', async () => {
    const commits = await collectCommitsInRange('base', [
      Array.from({ length: 100 }, (_, index) => ({ sha: `commit-${index}` })),
      [{ sha: 'commit-100' }, { sha: 'base' }, { sha: 'older' }],
    ]);

    expect(commits).toHaveLength(101);
    expect(commits.at(-1)?.sha).toBe('commit-100');
  });

  test('does not silently stop at a short page before finding the base', () => {
    expect(() => collectCommitsInRange('base', [[{ sha: 'commit-1' }]])).toThrow(
      'was not found in the main history',
    );
  });
});

describe('published release boundary selection', () => {
  const history = [
    'current-target',
    'newer-published',
    'orphan-target',
    'older-published',
    'root-target',
  ];
  const existingTags = {
    '2026.08.18': 'older-published',
    '2026.08.19': 'orphan-target',
    '2026.08.20': 'newer-published',
    '2026.08.21': 'off-main',
  };

  test('accepts only published dated releases', () => {
    expect(
      isPublishedDatedRelease({
        tag_name: '2026.08.20',
        draft: false,
        prerelease: false,
        published_at: '2026-08-20T00:00:00Z',
      }),
    ).toBe(true);
    expect(
      isPublishedDatedRelease({
        tag_name: '2026.08.20',
        draft: true,
        prerelease: false,
        published_at: null,
      }),
    ).toBe(false);
    expect(
      isPublishedDatedRelease({
        tag_name: '2026.08.20',
        draft: false,
        prerelease: true,
        published_at: '2026-08-20T00:00:00Z',
      }),
    ).toBe(false);
    expect(
      isPublishedDatedRelease({
        tag_name: 'v1.0.0',
        draft: false,
        prerelease: false,
        published_at: '2026-08-20T00:00:00Z',
      }),
    ).toBe(false);
  });

  test('uses the target when a newer published release already covers it', () => {
    expect(
      selectReleaseBoundary(
        history,
        'orphan-target',
        existingTags,
        new Set(['2026.08.18', '2026.08.20']),
      ),
    ).toBe('orphan-target');
  });

  test('uses the nearest older published commit when no newer release covers the target', () => {
    expect(
      selectReleaseBoundary(history, 'orphan-target', existingTags, new Set(['2026.08.18'])),
    ).toBe('older-published');
  });

  test('uses the newer commit boundary after a historical orphan is published', () => {
    expect(
      selectReleaseBoundary(
        history,
        'current-target',
        existingTags,
        new Set(['2026.08.18', '2026.08.19', '2026.08.20']),
      ),
    ).toBe('newer-published');
  });

  test('ignores published tags outside the target first-parent history', () => {
    expect(
      selectReleaseBoundary(history, 'current-target', existingTags, new Set(['2026.08.21'])),
    ).toBe('root-target');
  });

  test('uses the root when no published boundary precedes the target', () => {
    expect(selectReleaseBoundary(history, 'orphan-target', existingTags, new Set())).toBe(
      'root-target',
    );
    expect(selectReleaseBoundary(history, 'root-target', existingTags, new Set())).toBe(
      'root-target',
    );
  });

  test('fails closed when the selected target is outside first-parent history', () => {
    expect(() =>
      selectReleaseBoundary(history, 'off-main', existingTags, new Set(['2026.08.21'])),
    ).toThrow('is not in the first-parent history');
  });
});

describe('dated tag selection', () => {
  test('discovers dated tags across UTC dates and ignores unrelated tags', () => {
    expect(
      datedTagsFromRefOutput(
        '2026.08.21 old-target\n2026.08.22-2 current-target\nv1.0.0 unrelated-target',
      ),
    ).toEqual(['2026.08.21', '2026.08.22-2']);
  });

  test('reuses an existing tag when it already points at the target', () => {
    expect(
      selectDatedTag(
        '2026.08.21',
        'target',
        {
          '2026.08.21': 'target',
        },
        new Set(),
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'reuse',
      releaseTargetSha: 'target',
    });
  });

  test('does not create a suffix for a same-target retry', () => {
    expect(
      selectDatedTag(
        '2026.08.21',
        'target',
        {
          '2026.08.21': 'target',
          '2026.08.21-1': 'other',
        },
        new Set(),
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'reuse',
      releaseTargetSha: 'target',
    });
  });

  test('recovers an unpublished orphan without moving its tag', () => {
    expect(
      selectDatedTag(
        '2026.08.21',
        'new-target',
        {
          '2026.08.21': 'old-target',
        },
        new Set(),
        ['new-target', 'old-target'],
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'recover',
      releaseTargetSha: 'old-target',
    });
  });

  test('uses a suffix when the existing tag already has a published release', () => {
    expect(
      selectDatedTag(
        '2026.08.21',
        'new-target',
        {
          '2026.08.21': 'old-target',
        },
        new Set(['2026.08.21']),
      ),
    ).toEqual({
      tag: '2026.08.21-1',
      action: 'create',
      releaseTargetSha: 'new-target',
    });
  });

  test('recovers a prior-date orphan before creating a tag for today', () => {
    expect(
      selectDatedTag(
        '2026.08.22',
        'current-target',
        {
          '2026.08.21': 'orphan-target',
        },
        new Set(),
        ['current-target', 'orphan-target'],
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'recover',
      releaseTargetSha: 'orphan-target',
    });
  });

  test('recovers an orphan older than a later published release', () => {
    const history = [
      'current-target',
      'newer-published',
      'orphan-target',
      'older-published',
      'root-target',
    ];
    const existingTags = {
      '2026.08.18': 'older-published',
      '2026.08.19': 'orphan-target',
      '2026.08.20': 'newer-published',
    };
    const publishedTags = new Set(['2026.08.18', '2026.08.20']);
    const selection = selectDatedTag(
      '2026.08.21',
      'current-target',
      existingTags,
      publishedTags,
      history,
    );

    expect(selection).toEqual({
      tag: '2026.08.19',
      action: 'recover',
      releaseTargetSha: 'orphan-target',
    });
    expect(
      selectReleaseBoundary(history, selection.releaseTargetSha, existingTags, publishedTags),
    ).toBe('orphan-target');

    publishedTags.add(selection.tag);
    const nextSelection = selectDatedTag(
      '2026.08.21',
      'current-target',
      existingTags,
      publishedTags,
      history,
    );

    expect(nextSelection).toEqual({
      tag: '2026.08.21',
      action: 'create',
      releaseTargetSha: 'current-target',
    });
    expect(
      selectReleaseBoundary(history, nextSelection.releaseTargetSha, existingTags, publishedTags),
    ).toBe('newer-published');
  });

  test('recovers multiple covered historical orphans without overlapping ranges', () => {
    const history = [
      'current-target',
      'newer-published',
      'later-orphan',
      'earlier-orphan',
      'older-published',
      'root-target',
    ];
    const existingTags = {
      '2026.08.18': 'older-published',
      '2026.08.19': 'earlier-orphan',
      '2026.08.20': 'later-orphan',
      '2026.08.21': 'newer-published',
    };
    const publishedTags = new Set(['2026.08.18', '2026.08.21']);
    const first = selectDatedTag(
      '2026.08.22',
      'current-target',
      existingTags,
      publishedTags,
      history,
    );

    expect(first.releaseTargetSha).toBe('earlier-orphan');
    expect(
      selectReleaseBoundary(history, first.releaseTargetSha, existingTags, publishedTags),
    ).toBe('earlier-orphan');

    publishedTags.add(first.tag);
    const second = selectDatedTag(
      '2026.08.22',
      'current-target',
      existingTags,
      publishedTags,
      history,
    );

    expect(second.releaseTargetSha).toBe('later-orphan');
    expect(
      selectReleaseBoundary(history, second.releaseTargetSha, existingTags, publishedTags),
    ).toBe('later-orphan');

    publishedTags.add(second.tag);
    const current = selectDatedTag(
      '2026.08.22',
      'current-target',
      existingTags,
      publishedTags,
      history,
    );

    expect(current.releaseTargetSha).toBe('current-target');
    expect(
      selectReleaseBoundary(history, current.releaseTargetSha, existingTags, publishedTags),
    ).toBe('newer-published');
  });

  test('publishes an orphan range before the remaining current range', () => {
    const existingTags = { '2026.08.21': 'orphan-target' };
    const history = ['current-target', 'orphan-target'];
    const first = selectDatedTag('2026.08.22', 'current-target', existingTags, new Set(), history);
    const second = selectDatedTag(
      '2026.08.22',
      'current-target',
      existingTags,
      new Set([first.tag]),
      history,
    );

    expect(first.releaseTargetSha).toBe('orphan-target');
    expect(second).toEqual({
      tag: '2026.08.22',
      action: 'create',
      releaseTargetSha: 'current-target',
    });
  });

  test('recovers multiple orphans in first-parent order', () => {
    expect(
      selectDatedTag(
        '2026.08.23',
        'current-target',
        {
          '2026.08.20': 'later-target',
          '2026.08.21': 'earlier-target',
        },
        new Set(),
        ['current-target', 'later-target', 'earlier-target'],
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'recover',
      releaseTargetSha: 'earlier-target',
    });
  });

  test('ignores orphans outside the eligible release path', () => {
    expect(
      selectDatedTag(
        '2026.08.22',
        'current-target',
        {
          '2026.08.19': 'before-boundary',
          '2026.08.20': 'off-main',
        },
        new Set(),
        ['current-target'],
      ),
    ).toEqual({
      tag: '2026.08.22',
      action: 'create',
      releaseTargetSha: 'current-target',
    });
  });

  test('preserves an off-main tag for today and creates a suffix', () => {
    expect(
      selectDatedTag(
        '2026.08.22',
        'current-target',
        {
          '2026.08.22': 'off-main',
        },
        new Set(),
        ['current-target'],
      ),
    ).toEqual({
      tag: '2026.08.22-1',
      action: 'create',
      releaseTargetSha: 'current-target',
    });
  });

  test('recovers an unpublished tag on the repository root', () => {
    const history = ['current-target', 'middle-target', 'root-target'];

    expect(
      selectDatedTag(
        '2026.08.22',
        'current-target',
        { '2026.08.21': 'root-target' },
        new Set(),
        history,
      ),
    ).toEqual({
      tag: '2026.08.21',
      action: 'recover',
      releaseTargetSha: 'root-target',
    });
  });
});

describe('release notes rendering', () => {
  test('includes the exact release range', () => {
    const notes = renderNotes([pr()], 'base123', 'target456');
    expect(notes).toContain('Changes: base123..target456');
  });

  test('includes breaking-change guidance', () => {
    const notes = renderNotes(
      [pr({ body: 'BREAKING CHANGE: migrate this setting' })],
      'base123',
      'target456',
    );
    expect(notes).toContain(
      'Action required: review the linked pull requests for database migrations',
    );
  });

  test('reports an empty exact range without referring to a wall-clock cutoff', () => {
    const notes = renderNotes([], 'base123', 'target456');
    expect(notes).toContain('No merged pull requests found in this release range.');
    expect(notes).not.toContain('since the last tag');
  });
});
