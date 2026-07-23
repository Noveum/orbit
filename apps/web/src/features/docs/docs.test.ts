import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { renderMarkdown, summarize } from '@orbit/services/markdown';
import { act, renderHook } from '@testing-library/react';
import { publicDocPath, publicDocUrl } from '@/lib/docs/paths.ts';
import { descendantIds } from './doc-surface.tsx';
import { docTreeOf } from './doc-tree.tsx';
import {
  attachmentMarkdown,
  insertBlock,
  linkSelection,
  replaceSlashQuery,
  SNIPPETS,
  wrapSelection,
} from './markdown-input.ts';
import { readTimeMinutes, sameHeadings, slugify, withHeadingIds } from './outline.ts';
import {
  canonicalDocUrl,
  isIndexable,
  publishedDocJsonLd,
  publishedDocMetadata,
} from './published-doc-meta.ts';
import { templateById } from './templates.ts';
import { uploadDocFile } from './upload.ts';
import { AUTOSAVE_DELAY_MS, useAutosave } from './use-autosave.ts';
import { activeHeadingId } from './use-scroll-spy.ts';

describe('withHeadingIds', () => {
  it('reads the headings the reader actually rendered, including indented and setext ones', () => {
    const html = renderMarkdown(
      [
        '  # Realtime **protocol**',
        '',
        'Action shape',
        '============',
        '',
        '```md',
        '# Not a heading',
        '```',
        '',
        '### `Rules`',
        '',
        '#### Too deep',
      ].join('\n'),
    );

    expect(withHeadingIds(html).headings).toEqual([
      { id: 'realtime-protocol', text: 'Realtime protocol', level: 1 },
      { id: 'action-shape', text: 'Action shape', level: 1 },
      { id: 'rules', text: 'Rules', level: 3 },
    ]);
  });

  it('survives an unbalanced fence rather than swallowing every heading after it', () => {
    const html = renderMarkdown('## Setup\n\n```ts\nconst a = 1;\n\n## Teardown\n');
    expect(withHeadingIds(html).headings.map((entry) => entry.text)).toEqual(['Setup']);
  });

  it('bakes the ids into the html so a rerender cannot wipe them', () => {
    const outlined = withHeadingIds(renderMarkdown('## Setup\n\n## Setup\n'));
    expect(outlined.headings.map((entry) => entry.id)).toEqual(['setup', 'setup-1']);
    expect(outlined.html).toBe('<h2 id="setup">Setup</h2>\n<h2 id="setup-1">Setup</h2>\n');
    expect(withHeadingIds(outlined.html).html).toBe(outlined.html);
    expect(slugify('   ')).toBe('section');
  });

  it('reads through inline markup and entities to the heading text', () => {
    const outlined = withHeadingIds(renderMarkdown('## Batch & `sync_id`\n'));
    expect(outlined.headings[0]).toEqual({
      id: 'batch-sync-id',
      text: 'Batch & sync_id',
      level: 2,
    });
    expect(outlined.html).toContain('id="batch-sync-id"');
  });

  it('compares heading lists by id so the reader does not loop on every render', () => {
    const one = [{ id: 'a', text: 'A', level: 2 }];
    expect(sameHeadings(one, [{ id: 'a', text: 'renamed', level: 2 }])).toBe(true);
    expect(sameHeadings(one, [{ id: 'b', text: 'A', level: 2 }])).toBe(false);
    expect(sameHeadings(one, [])).toBe(false);
  });

  it('never reports less than a minute of reading', () => {
    expect(readTimeMinutes('')).toBe(1);
    expect(readTimeMinutes('word '.repeat(660))).toBe(3);
  });
});

describe('activeHeadingId', () => {
  it('seeds the first heading at scroll top and never goes empty', () => {
    const tops = [
      { id: 'intro', top: 400 },
      { id: 'rules', top: 900 },
    ];
    expect(activeHeadingId(tops, 96)).toBe('intro');
    expect(activeHeadingId([], 96)).toBeNull();
  });

  it('follows the last heading that crossed the line', () => {
    const tops = [
      { id: 'intro', top: -800 },
      { id: 'rules', top: -120 },
      { id: 'checklist', top: 640 },
    ];
    expect(activeHeadingId(tops, 96)).toBe('rules');
    expect(activeHeadingId([{ id: 'intro', top: -10 }], 96)).toBe('intro');
  });
});

describe('published doc urls', () => {
  it('builds a readable slug url and keeps a slugless doc addressable', () => {
    expect(publicDocPath({ slug: 'delta-protocol', publishToken: 'abc123' })).toBe(
      '/d/delta-protocol-abc123',
    );
    expect(publicDocPath({ slug: '', publishToken: 'abc123' })).toBe('/d/abc123');
    expect(publicDocPath({ slug: 'x', publishToken: null })).toBeNull();
    expect(publicDocUrl({ slug: 'a b', publishToken: 't' }, 'https://orbit.test')).toBe(
      'https://orbit.test/d/a%20b-t',
    );
  });
});

describe('published doc seo', () => {
  const base = {
    title: 'Delta protocol',
    summary: 'How deltas fan out.',
    slug: 'delta-protocol',
    publishToken: 'tok',
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    authorName: 'Pulkit',
    origin: 'https://orbit.test',
  };

  it('treats an unlisted doc and a public doc differently', () => {
    const unlisted = publishedDocMetadata({ ...base, visibility: 'link' });
    const isPublic = publishedDocMetadata({ ...base, visibility: 'public' });

    expect(isIndexable('link')).toBe(false);
    expect(isIndexable('public')).toBe(true);
    expect(unlisted.robots).toMatchObject({ index: false, follow: false });
    expect(isPublic.robots).toMatchObject({ index: true, follow: true });
    expect(publishedDocJsonLd({ ...base, visibility: 'link' })).toBeNull();

    const jsonLd = publishedDocJsonLd({ ...base, visibility: 'public' });
    expect(jsonLd).not.toBeNull();
    expect(JSON.parse(jsonLd ?? '{}')).toMatchObject({
      '@type': 'Article',
      headline: 'Delta protocol',
      url: 'https://orbit.test/d/delta-protocol-tok',
    });
  });

  it('points both modes at the canonical slug url', () => {
    expect(canonicalDocUrl({ ...base, visibility: 'public' })).toBe(
      'https://orbit.test/d/delta-protocol-tok',
    );
    expect(publishedDocMetadata({ ...base, visibility: 'link' }).alternates).toEqual({
      canonical: 'https://orbit.test/d/delta-protocol-tok',
    });
  });
});

describe('doc nesting', () => {
  function summary(id: string, parentId: string | null) {
    return {
      id,
      organizationId: 'org',
      collectionId: null,
      projectId: null,
      parentId,
      title: id,
      slug: id,
      content: '',
      visibility: 'workspace',
      publishToken: null,
      authorId: 'u',
      repoBinding: null,
      syncId: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
      excerpt: '',
    };
  }

  it('renders three levels of depth from one flat list', () => {
    const nodes = docTreeOf([
      summary('grandchild', 'child'),
      summary('root', null),
      summary('child', 'root'),
      summary('orphan', 'gone'),
    ]);

    expect(nodes.map((node) => [node.doc.id, node.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
      ['orphan', 0],
    ]);
  });

  it('refuses to offer a doc its own subtree as a parent', () => {
    const docs = [summary('root', null), summary('child', 'root'), summary('other', null)];
    const blocked = descendantIds(docs, 'root');
    expect([...blocked].sort()).toEqual(['child', 'root']);
    expect(blocked.has('other')).toBe(false);
  });
});

describe('doc templates', () => {
  it('falls back to the blank template for an unknown id', () => {
    expect(templateById('runbook').title).toBe('Runbook');
    expect(templateById('nope').id).toBe('blank');
    expect(templateById(null).id).toBe('blank');
  });
});

describe('markdown pipeline wiring', () => {
  it('renders the doc constructs the reader relies on', () => {
    const html = renderMarkdown(
      '## Rules\n\n| Rule | Why |\n| --- | --- |\n| Batch | Speed |\n\n- [x] Done\n- [ ] Next\n\n`inline`\n\n```ts\nconst a = 1;\n```\n',
    );
    expect(html).toContain('<h2>Rules</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Rule</th>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('<pre>');
  });

  it('strips scripts and event handlers before they reach the reader', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('summarizes a doc body into a plain excerpt', () => {
    expect(summarize('# Title\n\nSome **body** text.', 40)).toBe('Title Some body text.');
  });
});

describe('markdown input helpers', () => {
  it('wraps and unwraps a selection', () => {
    const bold = wrapSelection({ value: 'make it loud', start: 8, end: 12 }, '**');
    expect(bold.value).toBe('make it **loud**');
    expect(bold.value.slice(bold.start, bold.end)).toBe('loud');

    const undone = wrapSelection({ value: bold.value, start: 8, end: 16 }, '**');
    expect(undone.value).toBe('make it loud');
  });

  it('builds a link with the url selected', () => {
    const result = linkSelection({ value: 'see docs', start: 4, end: 8 });
    expect(result.value).toBe('see [docs](https://)');
    expect(result.value.slice(result.start, result.end)).toBe('https://');
  });

  it('inserts a block on its own line and replaces the slash query', () => {
    expect(insertBlock({ value: 'intro', start: 5, end: 5 }, SNIPPETS.tasks).value).toBe(
      `intro\n\n${SNIPPETS.tasks}`,
    );
    expect(
      replaceSlashQuery({ value: 'intro\n\n/tab', start: 11, end: 11 }, SNIPPETS.table).value,
    ).toBe(`intro\n\n${SNIPPETS.table}`);
  });

  it('picks image markdown only for images', () => {
    expect(attachmentMarkdown('a.png', 'image/png', '/f/a')).toBe('![a.png](/f/a)');
    expect(attachmentMarkdown('a.pdf', 'application/pdf', '/f/a')).toBe('[a.pdf](/f/a)');
  });
});

describe('useAutosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('saves once after the caller stops typing', async () => {
    const save = mock().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'a' },
    });

    expect(result.current.status).toBe('saved');

    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current.status).toBe('unsaved');

    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(result.current.status).toBe('saved');
  });

  it('forces a save immediately and reports a failure', async () => {
    const save = mock().mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(({ value }) => useAutosave({ value, save }), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    await act(async () => {
      result.current.saveNow();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');

    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('uploadDocFile', () => {
  const attachment = {
    id: 'att_1',
    parentType: 'doc',
    parentId: 'doc_1',
    fileName: 'note.png',
    contentType: 'image/png',
    size: 4,
    storageKey: 'org_1/2026/07/note.png',
    status: 'pending',
  };

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('presigns, uploads to the returned url, then confirms completion', async () => {
    const calls: string[] = [];
    const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/attachments/presign') {
        return Promise.resolve(
          jsonResponse({
            attachment,
            upload: {
              key: attachment.storageKey,
              url: 'https://s3.example.com/signed',
              method: 'PUT',
              headers: { 'content-type': 'image/png' },
            },
          }),
        );
      }
      if (url === 'https://s3.example.com/signed')
        return Promise.resolve(new Response(null, { status: 200 }));
      if (url === `/api/attachments/${attachment.id}/complete`) {
        return Promise.resolve(jsonResponse({ attachment: { ...attachment, status: 'ready' } }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'note.png', { type: 'image/png' });
    const result = await uploadDocFile('doc_1', file);

    expect(calls).toEqual([
      'POST /api/attachments/presign',
      'PUT https://s3.example.com/signed',
      `POST /api/attachments/${attachment.id}/complete`,
    ]);
    expect(result.url).toBe('/api/files/org_1/2026/07/note.png');
  });

  it('fails when the completion call is rejected', async () => {
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/attachments/presign') {
        return Promise.resolve(
          jsonResponse({
            attachment,
            upload: {
              key: attachment.storageKey,
              url: 'https://s3.example.com/signed',
              method: 'PUT',
              headers: { 'content-type': 'image/png' },
            },
          }),
        );
      }
      if (url === 'https://s3.example.com/signed')
        return Promise.resolve(new Response(null, { status: 200 }));
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'note.png', { type: 'image/png' });
    await expect(uploadDocFile('doc_1', file)).rejects.toThrow();
  });
});
