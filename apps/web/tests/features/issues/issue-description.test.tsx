import { describe, expect, it, mock } from 'bun:test';
import { ISSUE_DESCRIPTION_MAX_LENGTH } from '@orbit/shared/constants';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChangeEvent, ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

const EDITOR_MODULE = '@/features/docs/editor/rich-text-editor.tsx';
await restoreModulesAfterThisFile([EDITOR_MODULE]);

mock.module(EDITOR_MODULE, () => ({
  RichTextEditor: ({
    value,
    onChange,
    onBlur,
    footer,
  }: {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    footer?: ReactNode;
  }) => (
    <div>
      <textarea
        aria-label="Issue description"
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onBlur={() => onBlur?.()}
      />
      {footer}
    </div>
  ),
}));

const { IssueBody } = await import('@/features/issues/issue-detail.tsx');

function issue(): Issue {
  return { id: 'issue_1', description: '' } as unknown as Issue;
}

function mountBody(onCommit: (description: string) => Promise<unknown>): void {
  render(
    <ToastProvider>
      <IssueBody issue={issue()} members={[]} onCommit={onCommit} />
    </ToastProvider>,
  );
}

describe('saving an issue description', () => {
  it('keeps an oversized draft local until it fits the server contract', async () => {
    const onCommit = mock(async (_description: string) => undefined);
    mountBody(onCommit);
    const editor = screen.getByLabelText('Issue description');

    fireEvent.change(editor, {
      target: { value: 'x'.repeat(ISSUE_DESCRIPTION_MAX_LENGTH + 1) },
    });
    fireEvent.blur(editor);

    expect(await screen.findByTestId('issue-description-limit')).toHaveTextContent(
      '500,000 characters or fewer',
    );
    expect(onCommit).not.toHaveBeenCalled();

    const accepted = 'x'.repeat(150_000);
    fireEvent.change(editor, { target: { value: accepted } });
    fireEvent.blur(editor);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0]?.[0]).toBe(accepted);
    expect(screen.queryByTestId('issue-description-limit')).toBeNull();
  });
});
