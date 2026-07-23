import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { renderMarkdown, summarize } from '@orbit/services/markdown';
import { act, renderHook } from '@testing-library/react';
import {
  attachmentMarkdown,
  insertBlock,
  linkSelection,
  replaceSlashQuery,
  SNIPPETS,
  wrapSelection,
} from './markdown-input.ts';
import { outlineOf, readTimeMinutes, slugify } from './outline.ts';
import { uploadContentType, uploadDocFile } from './upload.ts';
import { AUTOSAVE_DELAY_MS, useAutosave } from './use-autosave.ts';

describe('outlineOf', () => {
  it('collects headings, strips inline marks, and skips fenced code', () => {
    const outline = outlineOf(
      '# Realtime **protocol**\n\n```md\n# Not a heading\n```\n\n## Action shape\n\n### `Rules`\n\n#### Too deep\n',
    );
    expect(outline).toEqual([
      { id: 'realtime-protocol', text: 'Realtime protocol', level: 1 },
      { id: 'action-shape', text: 'Action shape', level: 2 },
      { id: 'rules', text: 'Rules', level: 3 },
    ]);
  });

  it('keeps duplicate headings addressable', () => {
    expect(outlineOf('## Setup\n\n## Setup\n').map((entry) => entry.id)).toEqual([
      'setup',
      'setup-1',
    ]);
    expect(slugify('   ')).toBe('section');
  });

  it('never reports less than a minute of reading', () => {
    expect(readTimeMinutes('')).toBe(1);
    expect(readTimeMinutes('word '.repeat(660))).toBe(3);
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

describe('uploadContentType', () => {
  it('sniffs the extension when the browser reports nothing', () => {
    expect(uploadContentType({ name: 'Report Q3.PDF', type: '' })).toBe('application/pdf');
    expect(uploadContentType({ name: 'shot.png', type: 'application/octet-stream' })).toBe(
      'image/png',
    );
    expect(uploadContentType({ name: 'notes.md', type: '' })).toBe('text/markdown');
  });

  it('keeps the type the browser reported when it is supported', () => {
    expect(uploadContentType({ name: 'clip.bin', type: 'Video/MP4' })).toBe('video/mp4');
  });

  it('names the offending type instead of falling back to octet-stream', () => {
    expect(() =>
      uploadContentType({ name: 'setup.exe', type: 'application/x-msdownload' }),
    ).toThrow('That file type is not supported. (application/x-msdownload)');
    expect(() => uploadContentType({ name: 'archive.rar', type: '' })).toThrow(
      'That file type is not supported. (.rar)',
    );
    expect(() => uploadContentType({ name: 'noextension', type: '' })).toThrow(
      'That file type is not supported. (noextension)',
    );
  });
});

describe('uploadDocFile', () => {
  const attachment = {
    id: 'att_1',
    parentType: 'doc',
    parentId: 'doc_1',
    fileName: 'brief.pdf',
    contentType: 'application/pdf',
    size: 4,
    storageKey: 'org_1/2026/07/brief.pdf',
    status: 'pending',
  };

  const signedHeaders = { 'content-type': 'application/pdf' };

  interface PutCall {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string>;
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  function stubApi(completeStatus = 200): string[] {
    const calls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
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
              headers: signedHeaders,
            },
          }),
        );
      }
      if (completeStatus === 200) {
        return Promise.resolve(jsonResponse({ attachment: { ...attachment, status: 'ready' } }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
          status: completeStatus,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    return calls;
  }

  function stubPut(statuses: readonly number[]): PutCall[] {
    const calls: PutCall[] = [];
    const queue = [...statuses];
    class FakeXhr {
      status = 0;
      private method = '';
      private url = '';
      private readonly headers: Record<string, string> = {};
      private readonly listeners = new Map<string, () => void>();
      private progress: ((event: ProgressEvent) => void) | null = null;
      readonly upload = {
        addEventListener: (name: string, run: (event: ProgressEvent) => void) => {
          if (name === 'progress') this.progress = run;
        },
      };
      open(method: string, url: string): void {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
      }
      addEventListener(name: string, run: () => void): void {
        this.listeners.set(name, run);
      }
      send(): void {
        calls.push({ method: this.method, url: this.url, headers: { ...this.headers } });
        this.progress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent);
        this.status = queue.shift() ?? 200;
        this.listeners.get('loadend')?.();
      }
    }
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    return calls;
  }

  const realFetch = globalThis.fetch;
  const realXhr = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.XMLHttpRequest = realXhr;
  });

  function pdf(): File {
    return new File([new Uint8Array([1, 2, 3, 4])], 'brief.pdf', { type: '' });
  }

  it('presigns, PUTs the signed headers verbatim, then confirms completion', async () => {
    const api = stubApi();
    const puts = stubPut([200]);
    const seen: number[] = [];

    const result = await uploadDocFile('doc_1', pdf(), {
      onProgress: ({ loaded, total }) => seen.push(Math.round((loaded / total) * 100)),
    });

    expect(api).toEqual([
      'POST /api/attachments/presign',
      `POST /api/attachments/${attachment.id}/complete`,
    ]);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.method).toBe('PUT');
    expect(puts[0]?.url).toBe('https://s3.example.com/signed');
    expect(puts[0]?.headers).toEqual(signedHeaders);
    expect(seen).toEqual([50]);
    expect(result.contentType).toBe('application/pdf');
    expect(result.url).toBe('/api/files/org_1/2026/07/brief.pdf');
  });

  it('retries a failed PUT and gives up with the last status', async () => {
    stubApi();
    const retried = stubPut([0, 200]);
    await uploadDocFile('doc_1', pdf());
    expect(retried).toHaveLength(2);

    stubApi();
    const refused = stubPut([403, 403, 403]);
    await expect(uploadDocFile('doc_1', pdf())).rejects.toThrow(
      'Uploading brief.pdf failed with status 403.',
    );
    expect(refused).toHaveLength(1);
  });

  it('fails when the completion call is rejected', async () => {
    stubApi(404);
    stubPut([200]);
    await expect(uploadDocFile('doc_1', pdf())).rejects.toThrow();
  });

  it('never presigns a file whose type is not supported', async () => {
    const api = stubApi();
    stubPut([200]);
    await expect(
      uploadDocFile('doc_1', new File([new Uint8Array([1])], 'setup.exe', { type: '' })),
    ).rejects.toThrow('That file type is not supported. (.exe)');
    expect(api).toEqual([]);
  });
});
