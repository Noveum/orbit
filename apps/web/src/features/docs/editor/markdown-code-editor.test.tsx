import { describe, expect, it, mock } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { wrapSelection } from '../markdown-input.ts';
import { MarkdownCodeEditor, type MarkdownCodeEditorHandle } from './markdown-code-editor.tsx';

function Harness({
  initial,
  onChange,
  onHandle,
}: {
  initial: string;
  onChange: (value: string) => void;
  onHandle: (handle: MarkdownCodeEditorHandle) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<MarkdownCodeEditorHandle>(null);
  return (
    <MarkdownCodeEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      onModKey={mock()}
      onFiles={mock()}
      ariaLabel="Markdown"
      testId="cm"
      handleRef={(instance) => {
        ref.current = instance;
        if (instance !== null) onHandle(instance);
      }}
    />
  );
}

function mount(
  initial = '',
): Promise<{ handle: MarkdownCodeEditorHandle; onChange: ReturnType<typeof mock> }> {
  return new Promise((resolve) => {
    const onChange = mock();
    render(
      <Harness
        initial={initial}
        onChange={onChange}
        onHandle={(handle) => resolve({ handle, onChange })}
      />,
    );
  });
}

describe('markdown code editor', () => {
  it('renders a content element carrying the test id and aria label', async () => {
    await mount('hello world');
    const content = document.querySelector('[data-testid="cm"]');
    expect(content).not.toBeNull();
    expect(content?.getAttribute('aria-label')).toBe('Markdown');
  });

  it('exposes the current selection through the handle', async () => {
    const { handle } = await mount('abcdef');
    const selection = handle.getSelection();
    expect(selection.value).toBe('abcdef');
  });

  it('applies an edit and emits the new markdown', async () => {
    const { handle, onChange } = await mount('bold');
    handle.applyEdit(wrapSelection({ value: 'bold', start: 0, end: 4 }, '**'));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe('**bold**'));
  });
});
