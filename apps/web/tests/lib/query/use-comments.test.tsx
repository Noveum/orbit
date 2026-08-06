import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Comment } from '../../../src/lib/query/schemas.ts';
import { SessionProvider } from '../../../src/lib/realtime/session.tsx';

const toasts: { title: string }[] = [];
mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({
    toast: (input: { title: string }) => {
      toasts.push(input);
    },
  }),
}));

const { useComments, useCreateComment, useDeleteComment, useToggleReaction, useUpdateComment } =
  await import('../../../src/lib/query/use-comments.ts');

const ISSUE = 'issue_1';
const ME = 'user_me';
const SOMEONE_ELSE = 'user_them';
const originalFetch = globalThis.fetch;

function comment(
  id: string,
  body: string,
  authorId = ME,
  reactions: Comment['reactions'] = [],
): Comment {
  return {
    comment: {
      id,
      issueId: ISSUE,
      authorId,
      parentId: null,
      body,
      editedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      syncId: 7,
    },
    bodyHtml: `<p>${body}</p>`,
    reactions,
  };
}

function reaction(id: string, commentId: string, userId: string, emoji: string) {
  return { id, commentId, userId, emoji };
}

interface Answer {
  readonly status?: number;
  readonly payload: unknown;
}

type Handler = (url: string, init: RequestInit | undefined) => Answer | Promise<Answer>;

interface FetchLog {
  readonly urls: string[];
  readonly methods: string[];
  readonly payloads: string[];
}

function stubFetch(handler: Handler): FetchLog {
  const log: FetchLog = { urls: [], methods: [], payloads: [] };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    log.urls.push(url);
    log.methods.push(init?.method ?? 'GET');
    log.payloads.push(String(init?.body ?? ''));
    const answer = await handler(url, init);
    return new Response(JSON.stringify(answer.payload), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return log;
}

interface Gate {
  readonly held: Promise<Answer>;
  release(answer: Answer): void;
}

function gate(): Gate {
  let open: (answer: Answer) => void = () => undefined;
  const held = new Promise<Answer>((resolve) => {
    open = resolve;
  });
  return { held, release: open };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider userId={ME}>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function bodies(rows: readonly Comment[] | undefined): string[] {
  return (rows ?? []).map((row) => row.comment.body);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  toasts.length = 0;
});

describe('useComments', () => {
  it('reads one bounded page of the thread', async () => {
    const log = stubFetch(() => ({ payload: { comments: [comment('c1', 'Hello')] } }));
    const client = newClient();

    const { result } = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(bodies(result.current.data)).toEqual(['Hello']);
    expect(log.urls[0]).toContain(`issueId=${ISSUE}`);
    expect(log.urls[0]).toContain('limit=50');
  });

  it('never asks when there is no issue to ask about', async () => {
    const log = stubFetch(() => ({ payload: { comments: [] } }));
    const client = newClient();

    renderHook(() => useComments(null), { wrapper: wrapper(client) });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(log.urls).toHaveLength(0);
  });
});

describe('useCreateComment', () => {
  it('paints the pending row, then swaps it for the server row with no duplicate', async () => {
    const post = gate();
    const log = stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return { payload: { comments: [comment('c1', 'Hello')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const create = renderHook(() => useCreateComment(ISSUE), { wrapper: wrapper(client) });
    create.result.current.mutate({ body: 'Posted', parentId: null });

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello', 'Posted']));
    const pendingId = (list.result.current.data ?? [])[1]?.comment.id ?? '';
    expect(pendingId.startsWith('pending-')).toBe(true);

    post.release({ payload: { comment: comment('c-server', 'Posted') } });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect((list.result.current.data ?? []).map((row) => row.comment.id)).toEqual([
        'c1',
        'c-server',
      ]),
    );

    expect(bodies(list.result.current.data)).toEqual(['Hello', 'Posted']);
    expect(log.methods.filter((method) => method === 'GET')).toHaveLength(1);
  });

  it('keeps only one row when the socket already delivered the server row', async () => {
    const post = gate();
    const log = stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return { payload: { comments: [comment('c1', 'Hello')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const create = renderHook(() => useCreateComment(ISSUE), { wrapper: wrapper(client) });
    create.result.current.mutate({ body: 'Posted', parentId: null });
    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello', 'Posted']));

    client.setQueryData<readonly Comment[]>(['comments', ISSUE], (current) => [
      ...(current ?? []),
      comment('c-server', 'Posted'),
    ]);

    post.release({ payload: { comment: comment('c-server', 'Posted') } });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect((list.result.current.data ?? []).map((row) => row.comment.id)).toEqual([
        'c1',
        'c-server',
      ]),
    );
    expect(log.methods.filter((method) => method === 'POST')).toHaveLength(1);
  });

  it('rolls the pending row back and warns when the post fails', async () => {
    const post = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return { payload: { comments: [comment('c1', 'Hello')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const create = renderHook(() => useCreateComment(ISSUE), { wrapper: wrapper(client) });
    create.result.current.mutate({ body: 'Doomed', parentId: null });

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello', 'Doomed']));

    post.release({ status: 500, payload: { error: { code: 'internal', message: 'nope' } } });
    await waitFor(() => expect(create.result.current.isError).toBe(true));
    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello']));

    expect(toasts.map((entry) => entry.title)).toEqual(['Could not post']);
  });
});

describe('useUpdateComment', () => {
  it('paints the edit, then settles on the server row', async () => {
    const patch = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') return patch.held;
      return { payload: { comments: [comment('c1', 'Hello')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const edit = renderHook(() => useUpdateComment(ISSUE), { wrapper: wrapper(client) });
    edit.result.current.mutate({ id: 'c1', body: 'Edited' });

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Edited']));
    expect(list.result.current.data?.[0]?.bodyHtml).toBe('');

    patch.release({ payload: { comment: comment('c1', 'Edited') } });
    await waitFor(() => expect(edit.result.current.isSuccess).toBe(true));

    expect(list.result.current.data?.[0]?.bodyHtml).toBe('<p>Edited</p>');
    expect(list.result.current.data).toHaveLength(1);
  });

  it('puts the old body back when the edit fails', async () => {
    const patch = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') return patch.held;
      return { payload: { comments: [comment('c1', 'Hello')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const edit = renderHook(() => useUpdateComment(ISSUE), { wrapper: wrapper(client) });
    edit.result.current.mutate({ id: 'c1', body: 'Edited' });

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Edited']));

    patch.release({ status: 403, payload: { error: { code: 'forbidden', message: 'not yours' } } });
    await waitFor(() => expect(edit.result.current.isError).toBe(true));
    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello']));

    expect(toasts.map((entry) => entry.title)).toEqual(['Could not edit']);
  });
});

describe('useDeleteComment', () => {
  it('takes the row out at once and leaves it out when the server agrees', async () => {
    const call = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'DELETE') return call.held;
      return { payload: { comments: [comment('c1', 'Hello'), comment('c2', 'Second')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const remove = renderHook(() => useDeleteComment(ISSUE), { wrapper: wrapper(client) });
    remove.result.current.mutate('c1');

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Second']));

    call.release({ payload: { deleted: true } });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(bodies(list.result.current.data)).toEqual(['Second']);
  });

  it('puts the row back when the delete fails', async () => {
    const call = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'DELETE') return call.held;
      return { payload: { comments: [comment('c1', 'Hello'), comment('c2', 'Second')] } };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const remove = renderHook(() => useDeleteComment(ISSUE), { wrapper: wrapper(client) });
    remove.result.current.mutate('c1');

    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Second']));

    call.release({ status: 403, payload: { error: { code: 'forbidden', message: 'not yours' } } });
    await waitFor(() => expect(remove.result.current.isError).toBe(true));
    await waitFor(() => expect(bodies(list.result.current.data)).toEqual(['Hello', 'Second']));

    expect(toasts.map((entry) => entry.title)).toEqual(['Could not delete']);
  });
});

function emojiOn(rows: readonly Comment[] | undefined, id: string): string[] {
  const entry = (rows ?? []).find((row) => row.comment.id === id);
  return (entry?.reactions ?? []).map((row) => `${row.userId}:${row.emoji}`).sort();
}

const PARTY = '\u{1F389}';
const EYES = '\u{1F440}';

describe('useToggleReaction', () => {
  it('paints my reaction on the named comment and posts it to that comment endpoint', async () => {
    const post = gate();
    const log = stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return {
        payload: {
          comments: [
            comment('c1', 'Hello', ME, [reaction('r1', 'c1', SOMEONE_ELSE, EYES)]),
            comment('c2', 'Second'),
          ],
        },
      };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const react = renderHook(() => useToggleReaction(ISSUE), { wrapper: wrapper(client) });
    react.result.current.mutate({ commentId: 'c1', emoji: PARTY });

    await waitFor(() =>
      expect(emojiOn(list.result.current.data, 'c1')).toEqual([
        `${ME}:${PARTY}`,
        `${SOMEONE_ELSE}:${EYES}`,
      ]),
    );
    expect(emojiOn(list.result.current.data, 'c2')).toEqual([]);

    post.release({ payload: { emoji: PARTY, active: true } });
    await waitFor(() => expect(react.result.current.isSuccess).toBe(true));

    const posted = log.urls.filter((_url, index) => log.methods[index] === 'POST');
    expect(posted).toEqual(['/api/comments/c1/reactions']);
    expect(
      log.payloads
        .filter((_payload, index) => log.methods[index] === 'POST')
        .map((payload) => JSON.parse(payload) as unknown),
    ).toEqual([{ emoji: PARTY }]);
    expect(emojiOn(list.result.current.data, 'c1')).toEqual([
      `${ME}:${PARTY}`,
      `${SOMEONE_ELSE}:${EYES}`,
    ]);
  });

  it('takes my own reaction back off and leaves the same emoji from someone else', async () => {
    const post = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return {
        payload: {
          comments: [
            comment('c1', 'Hello', ME, [
              reaction('mine', 'c1', ME, PARTY),
              reaction('theirs', 'c1', SOMEONE_ELSE, PARTY),
            ]),
          ],
        },
      };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const react = renderHook(() => useToggleReaction(ISSUE), { wrapper: wrapper(client) });
    react.result.current.mutate({ commentId: 'c1', emoji: PARTY });

    await waitFor(() =>
      expect(emojiOn(list.result.current.data, 'c1')).toEqual([`${SOMEONE_ELSE}:${PARTY}`]),
    );

    post.release({ payload: { emoji: PARTY, active: false } });
    await waitFor(() => expect(react.result.current.isSuccess).toBe(true));
    expect(emojiOn(list.result.current.data, 'c1')).toEqual([`${SOMEONE_ELSE}:${PARTY}`]);
  });

  it('puts the reactions back and warns when the server refuses', async () => {
    const post = gate();
    stubFetch((_url, init) => {
      if (init?.method === 'POST') return post.held;
      return {
        payload: {
          comments: [comment('c1', 'Hello', ME, [reaction('theirs', 'c1', SOMEONE_ELSE, EYES)])],
        },
      };
    });
    const client = newClient();

    const list = renderHook(() => useComments(ISSUE), { wrapper: wrapper(client) });
    await waitFor(() => expect(list.result.current.data).toBeDefined());

    const react = renderHook(() => useToggleReaction(ISSUE), { wrapper: wrapper(client) });
    react.result.current.mutate({ commentId: 'c1', emoji: PARTY });

    await waitFor(() =>
      expect(emojiOn(list.result.current.data, 'c1')).toEqual([
        `${ME}:${PARTY}`,
        `${SOMEONE_ELSE}:${EYES}`,
      ]),
    );

    post.release({ status: 403, payload: { error: { code: 'forbidden', message: 'no' } } });
    await waitFor(() => expect(react.result.current.isError).toBe(true));
    await waitFor(() =>
      expect(emojiOn(list.result.current.data, 'c1')).toEqual([`${SOMEONE_ELSE}:${EYES}`]),
    );

    expect(toasts.map((entry) => entry.title)).toEqual(['Could not react']);
  });
});
