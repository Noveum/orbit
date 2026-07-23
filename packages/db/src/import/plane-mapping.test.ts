import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetStore, inlineAssets } from './assets.ts';
import { htmlToMarkdown } from './markdown.ts';
import {
  displayNameFor,
  estimateFor,
  handleFor,
  orgRoleFor,
  priorityFor,
  projectStatusFor,
  slugFor,
  stateCategoryFor,
  teamKeyFor,
} from './plane-mapping.ts';
import type { PlaneIssue, PlaneMember, PlaneState } from './plane-source.ts';

function member(overrides: Partial<PlaneMember> = {}): PlaneMember {
  return {
    id: 'plane-member',
    first_name: 'Pulkit',
    last_name: '',
    email: 'pulkit@noveum.ai',
    display_name: 'pulkit',
    avatar_url: null,
    role_slug: 'member',
    is_active: true,
    is_bot: false,
    ...overrides,
  };
}

function state(overrides: Partial<PlaneState> = {}): PlaneState {
  return {
    id: 'plane-state',
    name: 'Todo',
    color: '#ffffff',
    group: 'unstarted',
    sequence: 0,
    is_triage: false,
    default: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function issue(overrides: Partial<PlaneIssue> = {}): PlaneIssue {
  return {
    id: 'plane-issue',
    name: 'Ship it',
    description_html: '',
    description_stripped: '',
    priority: 'none',
    sequence_id: 1,
    sort_order: 1024,
    state: 'plane-state',
    state_group: 'unstarted',
    parent: null,
    cycle_id: null,
    assignees: [],
    labels: [],
    created_by: null,
    start_date: null,
    target_date: null,
    estimate_point: null,
    point: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

describe('team keys', () => {
  it('uses the mapped short key for a known plane project', () => {
    expect(teamKeyFor('APIMKTENG', new Set())).toBe('ENG');
    expect(teamKeyFor('MARKETING', new Set())).toBe('MKT');
  });

  it('truncates an unmapped identifier to the six character limit', () => {
    expect(teamKeyFor('OPERATIONS', new Set())).toBe('OPERAT');
  });

  it('never returns a key that is already taken', () => {
    const taken = new Set(['ENG']);
    const key = teamKeyFor('APIMKTENG', taken);
    expect(key).not.toBe('ENG');
    expect(key).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
  });

  it('produces keys the identifier pattern accepts', () => {
    const taken = new Set<string>();
    for (const identifier of ['SALES', 'CUSTISSUES', 'SEOSPRINT', 'LNKDINMKT', 'NOVEU', 'V1PLAN']) {
      expect(teamKeyFor(identifier, taken)).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
    }
    expect(taken.size).toBe(6);
  });
});

describe('state categories', () => {
  it('maps plane groups onto orbit categories', () => {
    expect(stateCategoryFor(state({ group: 'backlog' }))).toBe('backlog');
    expect(stateCategoryFor(state({ group: 'unstarted' }))).toBe('unstarted');
    expect(stateCategoryFor(state({ group: 'started' }))).toBe('started');
    expect(stateCategoryFor(state({ group: 'completed' }))).toBe('completed');
    expect(stateCategoryFor(state({ group: 'cancelled' }))).toBe('canceled');
  });

  it('promotes a started state named for review', () => {
    expect(stateCategoryFor(state({ group: 'started', name: 'In Review' }))).toBe('review');
    expect(stateCategoryFor(state({ group: 'started', name: 'QA' }))).toBe('review');
  });

  it('treats a triage state as triage whatever its group', () => {
    expect(stateCategoryFor(state({ group: 'backlog', is_triage: true }))).toBe('triage');
    expect(stateCategoryFor(state({ group: 'backlog', name: 'Triage 1' }))).toBe('triage');
  });
});

describe('priorities', () => {
  it('maps every plane priority onto the orbit scale', () => {
    expect(priorityFor(issue({ priority: 'urgent' }))).toBe(1);
    expect(priorityFor(issue({ priority: 'high' }))).toBe(2);
    expect(priorityFor(issue({ priority: 'medium' }))).toBe(3);
    expect(priorityFor(issue({ priority: 'low' }))).toBe(4);
    expect(priorityFor(issue({ priority: 'none' }))).toBe(0);
  });

  it('falls back to no priority for an unknown value', () => {
    expect(priorityFor(issue({ priority: 'whatever' }))).toBe(0);
  });
});

describe('estimates', () => {
  it('prefers the point value and parses a string estimate', () => {
    expect(estimateFor(issue({ point: 5 }))).toBe(5);
    expect(estimateFor(issue({ estimate_point: '8' }))).toBe(8);
  });

  it('rejects a value the smallint column cannot hold', () => {
    expect(estimateFor(issue({ point: 40_000 }))).toBeNull();
    expect(estimateFor(issue({ estimate_point: 'large' }))).toBeNull();
    expect(estimateFor(issue())).toBeNull();
  });
});

describe('people', () => {
  it('collapses a duplicated surname', () => {
    expect(displayNameFor(member({ first_name: 'Pulkit', last_name: 'Pulkit' }))).toBe('Pulkit');
    expect(displayNameFor(member({ first_name: 'Shashank Agarwal', last_name: 'Agarwal' }))).toBe(
      'Shashank Agarwal',
    );
  });

  it('keeps handles unique', () => {
    const taken = new Set<string>();
    expect(handleFor(member(), taken)).toBe('pulkit');
    expect(handleFor(member({ id: 'other' }), taken)).toBe('pulkit-2');
  });

  it('maps an owner to an admin and a bot to a guest', () => {
    expect(orgRoleFor(member({ role_slug: 'owner' }))).toBe('admin');
    expect(orgRoleFor(member({ role_slug: 'member' }))).toBe('member');
    expect(orgRoleFor(member({ role_slug: 'admin', is_bot: true }))).toBe('guest');
  });
});

describe('project slugs', () => {
  it('slugifies and disambiguates', () => {
    const taken = new Set<string>();
    expect(slugFor('API.market Engineering', taken)).toBe('api-market-engineering');
    expect(slugFor('API.market Engineering', taken)).toBe('api-market-engineering-2');
  });
});

describe('project status', () => {
  const categories = new Map([
    ['open', 'backlog' as const],
    ['doing', 'started' as const],
    ['done', 'completed' as const],
  ]);

  it('reports an archived project as canceled', () => {
    expect(projectStatusFor([issue()], categories, true)).toBe('canceled');
  });

  it('reports an empty project as backlog', () => {
    expect(projectStatusFor([], categories, false)).toBe('backlog');
  });

  it('reports a finished project as completed', () => {
    expect(projectStatusFor([issue({ state: 'done' })], categories, false)).toBe('completed');
  });

  it('reports a started project as in progress', () => {
    expect(
      projectStatusFor([issue({ state: 'doing' }), issue({ state: 'open' })], categories, false),
    ).toBe('in_progress');
  });
});

describe('markdown conversion', () => {
  it('keeps links, headings and lists', () => {
    expect(htmlToMarkdown('<h2>Plan</h2><ul><li>One</li><li>Two</li></ul>')).toBe(
      '## Plan\n- One\n- Two',
    );
    expect(htmlToMarkdown('<p><a href="https://api.market">API.market</a></p>')).toBe(
      '[API.market](https://api.market)',
    );
  });

  it('falls back to the bare url when the anchor has no text', () => {
    expect(htmlToMarkdown('<p><a href="https://api.market"></a></p>')).toBe('https://api.market');
  });

  it('decodes entities and strips remaining markup', () => {
    expect(htmlToMarkdown('<p>Tom &amp; Jerry &lt;b&gt;</p>')).toBe('Tom & Jerry <b>');
  });

  it('returns an empty string for missing content', () => {
    expect(htmlToMarkdown(null)).toBe('');
    expect(htmlToMarkdown('')).toBe('');
  });
});

describe('inlining plane image assets', () => {
  const manifestRoot = mkdtempSync(resolve(tmpdir(), 'plane-assets-'));
  const storageRoot = mkdtempSync(resolve(tmpdir(), 'plane-storage-'));
  const assetId = 'd15ef111-8cc4-45d6-9ca0-0b2adc5594a7';

  beforeAll(() => {
    mkdirSync(resolve(manifestRoot, 'assets'), { recursive: true });
    writeFileSync(resolve(manifestRoot, 'assets', assetId), 'not really a png');
    writeFileSync(
      resolve(manifestRoot, 'assets.json'),
      JSON.stringify({
        [assetId]: { fileName: 'a "quoted" name.png', contentType: 'image/png', size: 16 },
      }),
    );
  });

  afterAll(() => {
    rmSync(manifestRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('rewrites the tag so markdown keeps both the alt text and the url', () => {
    const store = createAssetStore(manifestRoot, storageRoot, 'org_noveum');
    const html = `<image-component data-id="x" src="${assetId}" width="10px"></image-component>`;
    const markdown = htmlToMarkdown(inlineAssets(html, 'comment', 'comment-1', 'user-1', store));

    expect(markdown).toMatch(/^!\[a "quoted" name\.png\]\(\/api\/files\/org_noveum\/plane\//);
    expect(store.attachments).toHaveLength(1);
    expect(store.attachments[0]?.parentType).toBe('comment');
    expect(store.attachments[0]?.uploadedById).toBe('user-1');
  });

  it('registers one attachment however many places reference the same image', () => {
    const store = createAssetStore(manifestRoot, storageRoot, 'org_noveum');
    const html = `<image-component src="${assetId}"></image-component>`;
    inlineAssets(html, 'issue', 'issue-1', 'user-1', store);
    inlineAssets(html, 'comment', 'comment-1', 'user-2', store);
    expect(store.attachments).toHaveLength(1);
  });

  it('leaves an unknown asset alone rather than inventing a url', () => {
    const store = createAssetStore(manifestRoot, storageRoot, 'org_noveum');
    const html = '<image-component src="00000000-0000-0000-0000-000000000000"></image-component>';
    expect(inlineAssets(html, 'issue', 'issue-1', 'user-1', store)).toBe(html);
    expect(store.attachments).toHaveLength(0);
  });
});
