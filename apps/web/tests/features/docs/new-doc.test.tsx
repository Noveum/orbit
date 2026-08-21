import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactNode } from 'react';
import { cleanup, render, waitFor } from '@/test/render.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile([
  'next/navigation',
  '@/lib/query/use-docs.ts',
  '@/components/ui/toast.tsx',
]);

const replace = mock((_href: string) => undefined);
const created = mock(async (input: Record<string, unknown>) => ({ id: 'doc_new', ...input }));
const toast = mock((_options: Record<string, unknown>) => undefined);

mock.module('next/navigation', () => ({ useRouter: () => ({ replace }) }));
mock.module('@/lib/query/use-docs.ts', () => ({
  useCreateDoc: () => ({ mutateAsync: created }),
}));
mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

const { NewDoc } = await import('../../../src/features/docs/new-doc.tsx');

afterEach(() => {
  cleanup();
  replace.mockClear();
  created.mockClear();
  toast.mockClear();
});

describe('starting a new doc', () => {
  it('opens the doc it created', async () => {
    render(<NewDoc collectionId={null} projectId={null} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/docs/doc_new'));
    expect(toast).not.toHaveBeenCalled();
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

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const options = toast.mock.calls[0]?.[0];
    expect(options?.['title']).toBe('Could not create that document');
    expect(options?.['description']).toBe('The workspace refused that doc.');
    expect(options?.['tone']).toBe('danger');
    expect(replace).toHaveBeenCalledWith('/docs');
  });
});
