import { afterEach, describe, expect, it, mock } from 'bun:test';
import { DOC_CONTENT_LIMIT } from '@orbit/shared/validators';
import { cleanup, fireEvent, render, screen, waitFor } from '@/test/render.tsx';

const push = mock((_href: string) => undefined);
const created = mock(async (input: Record<string, unknown>) => ({ id: 'doc_new', ...input }));

mock.module('next/navigation', () => ({ useRouter: () => ({ push }) }));
mock.module('@/lib/query/use-docs.ts', () => ({
  useCreateDoc: () => ({ mutateAsync: created }),
}));

const { DocImport } = await import('./doc-import.tsx');

function fileOf(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' });
}

function pick(file: File): void {
  const input = screen.getByTestId('doc-import-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(() => {
  cleanup();
  push.mockClear();
  created.mockClear();
});

describe('importing a markdown file', () => {
  it('creates a doc from the file and opens it', async () => {
    render(<DocImport collectionId={null} projectId={null} />);
    pick(fileOf('runbook.md', '# Deploy runbook\n\nHow we ship.'));

    await waitFor(() => expect(created).toHaveBeenCalled());
    const input = created.mock.calls[0]?.[0];
    expect(input?.['title']).toBe('Deploy runbook');
    expect(input?.['content']).toBe('How we ship.');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/docs/doc_new'));
  });

  it('refuses a file too large to be a doc, before it reads it', async () => {
    render(<DocImport collectionId={null} projectId={null} />);
    const huge = fileOf('huge.md', 'x');
    Object.defineProperty(huge, 'size', { value: DOC_CONTENT_LIMIT * 8, configurable: true });
    pick(huge);

    await waitFor(() => expect(screen.getByTestId('doc-import')).not.toBeDisabled());
    expect(created).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('says so when the doc cannot be created rather than navigating', async () => {
    created.mockImplementationOnce(() =>
      Promise.reject(new Error('The workspace refused that doc.')),
    );
    render(<DocImport collectionId={null} projectId={null} />);
    pick(fileOf('runbook.md', '# Runbook\n\nBody.'));

    await waitFor(() => expect(created).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('doc-import')).not.toBeDisabled());
    expect(push).not.toHaveBeenCalled();
  });

  it('carries the collection it was started from onto the new doc', async () => {
    render(<DocImport collectionId="col_1" projectId={null} />);
    pick(fileOf('notes.md', 'Just a body.'));

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(created.mock.calls[0]?.[0]?.['collectionId']).toBe('col_1');
  });
});
