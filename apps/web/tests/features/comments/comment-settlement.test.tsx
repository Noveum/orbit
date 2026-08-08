import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { CommentThread } from '@/features/comments/comment-thread.tsx';
import type { Member } from '@/lib/query/schemas.ts';
import { useComments } from '@/lib/query/use-comments.ts';
import { SessionProvider } from '@/lib/realtime/session.tsx';

const AUTHOR = 'user_1';
const ISSUE = 'issue_1';
const CREATED_ID = 'comment_new';
const SETTLED_URL = '/api/files/org_1/2031/03/file.txt';

const members: readonly Member[] = [
  {
    id: AUTHOR,
    name: 'Shashank Agarwal',
    email: 'shashank@noveum.ai',
    image: null,
    handle: 'shashank',
    role: 'member',
  },
];

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
const originalUpload = globalThis.XMLHttpRequest;

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

function envelope(id: string, body: string): Record<string, unknown> {
  const now = '2031-03-04T10:00:00.000Z';
  return {
    comment: {
      id,
      issueId: ISSUE,
      authorId: AUTHOR,
      parentId: null,
      body,
      editedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncId: 1,
    },
    bodyHtml: '',
    reactions: [],
  };
}

function attachment(): Record<string, unknown> {
  return {
    id: 'attachment_1',
    parentType: 'comment',
    parentId: CREATED_ID,
    fileName: 'trace.log',
    contentType: 'text/plain',
    size: 15,
    storageKey: 'org_1/2031/03/file.txt',
    status: 'pending',
  };
}

interface Server {
  readonly sent: readonly Sent[];
  readonly reachedPresign: () => boolean;
  readonly letTheUploadFinish: () => void;
  readonly patched: () => readonly string[];
}

function stubServer(): Server {
  const sent: Sent[] = [];
  let asked = false;
  let open: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });

  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(raw) as Record<string, unknown>;
    sent.push({ url, method: init?.method ?? 'GET', body });

    if (url.includes('/api/attachments/presign')) {
      asked = true;
      await held;
      return Response.json({
        attachment: attachment(),
        upload: {
          key: 'org_1/2031/03/file.txt',
          url: 'https://storage.test/put',
          method: 'PUT',
          headers: {},
        },
      });
    }
    if (url.includes('/api/attachments/')) return Response.json({ attachment: attachment() });
    if (url.startsWith('/api/comments/')) {
      return Response.json({ comment: envelope(CREATED_ID, String(body['body'])) });
    }
    if (url.startsWith('/api/comments') && (init?.method ?? 'GET') === 'POST') {
      return Response.json({ comment: envelope(CREATED_ID, String(body['body'])) });
    }
    return Response.json({ comments: [] });
  }) as unknown as typeof fetch;

  globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;

  return {
    sent,
    reachedPresign: () => asked,
    letTheUploadFinish: () => open(),
    patched: () =>
      sent
        .filter((entry) => entry.method === 'PATCH')
        .map((entry) => String(entry.body['body'] ?? '')),
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalUpload;
});

function Thread() {
  const comments = useComments(ISSUE);
  return (
    <CommentThread issueId={ISSUE} comments={comments.data ?? []} activity={[]} members={members} />
  );
}

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider userId={AUTHOR}>
        <ToastProvider>
          <Thread />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

function surfaceOf(testId: string): HTMLElement {
  const node = screen.getByTestId(testId).querySelector('.ProseMirror');
  if (node === null) throw new Error(`no editor surface for ${testId}`);
  return node as HTMLElement;
}

function textFile(): File {
  return new File(['boom at line 12'], 'trace.log', { type: 'text/plain' });
}

async function postACommentCarryingAFile(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.upload(screen.getByTestId('comment-composer-file'), textFile());
  await waitFor(() => expect(surfaceOf('comment-composer').textContent).toContain('trace.log'));
  await user.click(screen.getByTestId('comment-composer-submit'));
  await screen.findByTestId(`comment-${CREATED_ID}`);
}

describe('a comment whose attachments are still uploading', () => {
  it('keeps an edit the author made while the upload was in flight', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    mount();

    await postACommentCarryingAFile(user);
    await waitFor(() => expect(server.reachedPresign()).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(surfaceOf(`comment-edit-${CREATED_ID}`));
    await user.paste(' and the stack is in the file');
    await user.click(screen.getByTestId(`comment-edit-${CREATED_ID}-submit`));
    await waitFor(() => expect(server.patched()).toHaveLength(1));

    server.letTheUploadFinish();
    await waitFor(() =>
      expect(server.sent.some((entry) => entry.url.includes('/complete'))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(server.patched()).toEqual(['trace.log and the stack is in the file']);
    expect(screen.getByTestId(`comment-${CREATED_ID}`).textContent).toContain(
      'and the stack is in the file',
    );
  });

  it('links the uploaded file into the body when the author left it alone', async () => {
    const server = stubServer();
    const user = userEvent.setup();
    mount();

    await postACommentCarryingAFile(user);
    await waitFor(() => expect(server.reachedPresign()).toBe(true));

    server.letTheUploadFinish();

    await waitFor(() => expect(server.patched()).toHaveLength(1));
    expect(server.patched()[0]).toBe(`[trace.log](${SETTLED_URL})`);
  });
});
