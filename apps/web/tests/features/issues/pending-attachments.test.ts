import { describe, expect, it, mock } from 'bun:test';
import type { UploadedFile } from '../../../src/features/docs/upload.ts';
import {
  attachPending,
  holdAttachment,
  releasePending,
  rewritePlaceholder,
} from '../../../src/features/issues/pending-attachments.ts';

function textFile(name: string): File {
  return new File(['body'], name, { type: 'text/plain' });
}

function uploaded(url: string): UploadedFile {
  return { fileName: 'ignored', contentType: 'text/plain', url };
}

describe('holding a file until the issue exists', () => {
  it('hands back a placeholder unique to each file', () => {
    const one = holdAttachment(textFile('one.txt'));
    const two = holdAttachment(textFile('two.txt'));

    expect(one.placeholder.length).toBeGreaterThan(0);
    expect(one.placeholder).not.toBe(two.placeholder);
    releasePending([one, two]);
  });
});

describe('rewriting a placeholder', () => {
  it('swaps only the link target, leaving an escaped file name intact', () => {
    const markdown = '[notes \\[1\\].txt](blob:0f0b-1)';

    expect(rewritePlaceholder(markdown, 'blob:0f0b-1', '/api/files/org/notes-1.txt')).toBe(
      '[notes \\[1\\].txt](/api/files/org/notes-1.txt)',
    );
  });

  it('rewrites every copy of the same placeholder', () => {
    const markdown = '![shot.png](blob:a1)\n\n[shot.png](blob:a1)';

    expect(rewritePlaceholder(markdown, 'blob:a1', '/api/files/shot.png')).toBe(
      '![shot.png](/api/files/shot.png)\n\n[shot.png](/api/files/shot.png)',
    );
  });

  it('leaves markdown alone when the placeholder is not in it', () => {
    expect(rewritePlaceholder('nothing here', 'blob:a1', '/api/files/x')).toBe('nothing here');
  });
});

describe('attaching held files once the issue is saved', () => {
  it('uploads each held file and points the description at the stored file', async () => {
    const first = { placeholder: 'blob:one', file: textFile('notes [1].txt') };
    const second = { placeholder: 'blob:two', file: textFile('plan.txt') };
    const upload = mock(
      async (file: File): Promise<UploadedFile> =>
        await Promise.resolve(uploaded(`/api/files/org/${file.name === 'plan.txt' ? 'b' : 'a'}`)),
    );

    const outcome = await attachPending(
      'See [notes \\[1\\].txt](blob:one) and [plan.txt](blob:two).',
      [first, second],
      upload,
    );

    expect(upload).toHaveBeenCalledTimes(2);
    expect(outcome.attached).toBe(2);
    expect(outcome.failures).toEqual([]);
    expect(outcome.description).toBe(
      'See [notes \\[1\\].txt](/api/files/org/a) and [plan.txt](/api/files/org/b).',
    );
  });

  it('reports the file that failed and never leaves a dead placeholder behind', async () => {
    const good = { placeholder: 'blob:good', file: textFile('kept.txt') };
    const bad = { placeholder: 'blob:bad', file: textFile('lost.txt') };
    const upload = mock(async (file: File): Promise<UploadedFile> => {
      if (file.name === 'lost.txt') throw new Error('Storage said no.');
      return await Promise.resolve(uploaded('/api/files/org/kept.txt'));
    });

    const outcome = await attachPending(
      '[kept.txt](blob:good) [lost.txt](blob:bad)',
      [good, bad],
      upload,
    );

    expect(outcome.attached).toBe(1);
    expect(outcome.failures).toEqual([{ fileName: 'lost.txt', reason: 'Storage said no.' }]);
    expect(outcome.description).toBe('[kept.txt](/api/files/org/kept.txt) lost.txt');
    expect(outcome.description).not.toContain('blob:');
  });

  it('still asks to be saved when every upload failed, so no blob url is kept', async () => {
    const bad = { placeholder: 'blob:bad', file: textFile('lost.txt') };
    const upload = mock((): Promise<UploadedFile> => Promise.reject(new Error('Storage said no.')));

    const outcome = await attachPending('![lost.txt](blob:bad)', [bad], upload);

    expect(outcome.attached).toBe(0);
    expect(outcome.rewritten).toBe(1);
    expect(outcome.description).toBe('lost.txt');
    expect(outcome.description).not.toContain('blob:');
  });

  it('does nothing and reports nothing when no file was held', async () => {
    const upload = mock(async (): Promise<UploadedFile> => await Promise.resolve(uploaded('/x')));

    const outcome = await attachPending('Just words.', [], upload);

    expect(upload).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      description: 'Just words.',
      attached: 0,
      rewritten: 0,
      failures: [],
    });
  });
});
