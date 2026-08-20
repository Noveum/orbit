import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@/test/render.tsx';

const replace = mock((_href: string) => undefined);
const created = mock(async (input: Record<string, unknown>) => ({ id: 'doc_new', ...input }));

mock.module('next/navigation', () => ({ useRouter: () => ({ replace }) }));
mock.module('@/lib/query/use-docs.ts', () => ({
  useCreateDoc: () => ({ mutateAsync: created }),
}));

const { NewDoc } = await import('../../../src/features/docs/new-doc.tsx');

afterEach(() => {
  cleanup();
  replace.mockClear();
  created.mockClear();
});

describe('starting a new doc', () => {
  it('opens the doc it created', async () => {
    render(<NewDoc collectionId={null} projectId={null} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/docs/doc_new'));
  });

  it('starts an html page from the html starter', async () => {
    render(<NewDoc collectionId={null} projectId={null} kind="html" />);

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(created.mock.calls[0]?.[0]?.['kind']).toBe('html');
  });

  it('says why the doc could not be created rather than failing silently', async () => {
    created.mockImplementationOnce(() =>
      Promise.reject(new Error('The workspace refused that doc.')),
    );
    render(<NewDoc collectionId={null} projectId={null} />);

    await waitFor(() =>
      expect(screen.getByText('The workspace refused that doc.')).toBeInTheDocument(),
    );
    expect(replace).toHaveBeenCalledWith('/docs');
  });
});
