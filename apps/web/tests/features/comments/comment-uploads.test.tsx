import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

const { usePendingCommentFiles } = await import('@/features/comments/comment-uploads.ts');

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
const originalUpload = globalThis.XMLHttpRequest;
const sent: Sent[] = [];

function attachmentBody(): Record<string, unknown> {
  return {
    id: 'attachment_1',
    parentType: 'comment',
    parentId: 'comment_7',
    fileName: 'trace.log',
    contentType: 'text/plain',
    size: 15,
    storageKey: 'org_1/2031/03/file.txt',
    status: 'pending',
  };
}

function stubFetch(): void {
  sent.length = 0;
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = typeof init?.body === 'string' ? init.body : '{}';
    sent.push({
      url,
      method: init?.method ?? 'GET',
      body: JSON.parse(raw) as Record<string, unknown>,
    });
    if (url.includes('/api/attachments/presign')) {
      return Promise.resolve(
        Response.json({
          attachment: attachmentBody(),
          upload: {
            key: 'org_1/2031/03/file.txt',
            url: 'https://storage.test/put',
            method: 'PUT',
            headers: {},
          },
        }),
      );
    }
    return Promise.resolve(Response.json({ attachment: attachmentBody() }));
  }) as unknown as typeof fetch;
}

class FakeUpload {
  upload = { addEventListener: () => undefined };
  private handlers: (() => void)[] = [];
  status = 200;
  open(): void {
    this.status = 200;
  }
  setRequestHeader(): void {
    this.status = 200;
  }
  addEventListener(_name: string, handler: () => void): void {
    this.handlers.push(handler);
  }
  send(): void {
    for (const handler of this.handlers) handler();
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalUpload;
});

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function textFile(name = 'trace.log'): File {
  return new File(['boom at line 12'], name, { type: 'text/plain' });
}

describe('usePendingCommentFiles', () => {
  it('holds a file behind a local placeholder until the comment exists', async () => {
    stubFetch();
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    const held = await result.current.hold(textFile());

    expect(held.fileName).toBe('trace.log');
    expect(held.contentType).toBe('text/plain');
    expect(held.url.startsWith('blob:')).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('uploads held files against the new comment and rewrites the body', async () => {
    stubFetch();
    globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    const held = await result.current.hold(textFile());
    const draft = result.current.draft(`See [trace.log](${held.url})`);
    const body = await draft.settle('comment_7');

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const presign = sent.find((entry) => entry.url.includes('/api/attachments/presign'));
    expect(presign?.body).toMatchObject({
      parentType: 'comment',
      parentId: 'comment_7',
      fileName: 'trace.log',
      contentType: 'text/plain',
    });
    expect(body).toBe('See [trace.log](/api/files/org_1/2031/03/file.txt)');
    expect(body?.includes('blob:')).toBe(false);
  });

  it('leaves the body alone when nothing was held', async () => {
    stubFetch();
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    const draft = result.current.draft('Plain words');
    expect(draft.body).toBe('Plain words');
    expect(await draft.settle('comment_7')).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('refuses a file type the workspace does not allow, without calling the server', async () => {
    stubFetch();
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    await expect(
      result.current.hold(new File(['MZ'], 'payload.exe', { type: 'application/x-msdownload' })),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('never hands the created comment a body that points at browser local bytes', async () => {
    stubFetch();
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    const held = await result.current.hold(textFile());
    const draft = result.current.draft(`See ![trace.log](${held.url}) for the stack`);

    expect(draft.body).toBe('See trace.log for the stack');
    expect(draft.body.includes('blob:')).toBe(false);
  });

  it('keeps the files of one composer out of the draft of another', async () => {
    stubFetch();
    globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;
    const reply = renderHook(() => usePendingCommentFiles(), { wrapper });
    const root = renderHook(() => usePendingCommentFiles(), { wrapper });

    const inReply = await reply.result.current.hold(textFile('reply.log'));
    const rootDraft = root.result.current.draft('Nothing attached here');

    expect(rootDraft.body).toBe('Nothing attached here');
    expect(await rootDraft.settle('comment_root')).toBeNull();
    expect(sent).toHaveLength(0);

    const replyDraft = reply.result.current.draft(`See [reply.log](${inReply.url})`);
    expect(await replyDraft.settle('comment_reply')).toBe(
      'See [reply.log](/api/files/org_1/2031/03/file.txt)',
    );
    const presign = sent.find((entry) => entry.url.includes('/api/attachments/presign'));
    expect(presign?.body).toMatchObject({ parentType: 'comment', parentId: 'comment_reply' });
  });

  it('lets the held bytes go when the comment is never created', async () => {
    stubFetch();
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    try {
      const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

      const held = await result.current.hold(textFile());
      const draft = result.current.draft(`See [trace.log](${held.url})`);
      draft.release();

      expect(revoked).toEqual([held.url]);
      expect(sent).toHaveLength(0);
    } finally {
      URL.revokeObjectURL = revoke;
    }
  });

  it('uploads straight to an existing comment when one is being edited', async () => {
    stubFetch();
    globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;
    const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });

    const uploaded = await result.current.upload('comment_9', textFile('shot.png'));

    const presign = sent.find((entry) => entry.url.includes('/api/attachments/presign'));
    expect(presign?.body).toMatchObject({ parentType: 'comment', parentId: 'comment_9' });
    expect(uploaded.url).toBe('/api/files/org_1/2031/03/file.txt');
  });
});

describe('letting go of files the comment never used', () => {
  it('revokes the object URL of every held file when the composer is discarded', async () => {
    const revoked: string[] = [];
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => revoked.push(url) && undefined;

    try {
      const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });
      const first = await result.current.hold(textFile('one.log'));
      const second = await result.current.hold(textFile('two.log'));

      result.current.discard();

      expect(revoked).toContain(first.url);
      expect(revoked).toContain(second.url);
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('does not revoke a file twice when settlement already released it', async () => {
    stubFetch();
    globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;
    const revoked: string[] = [];
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => revoked.push(url) && undefined;

    try {
      const { result } = renderHook(() => usePendingCommentFiles(), { wrapper });
      const held = await result.current.hold(textFile('once.log'));

      const draft = result.current.draft(`See [once.log](${held.url})`);
      await draft.settle('comment_7');
      result.current.discard();

      expect(revoked.filter((url) => url === held.url)).toHaveLength(1);
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
