import { describe, expect, it } from 'bun:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { RichTextEditor } from '../../../../src/features/docs/editor/rich-text-editor.tsx';

function Harness({ leading, trailing }: { leading?: React.ReactNode; trailing?: React.ReactNode }) {
  const [value, setValue] = useState('Hello');
  return (
    <TooltipProvider>
      <RichTextEditor
        value={value}
        onChange={setValue}
        toolbar="full"
        ariaLabel="Doc body"
        testId="doc-rich-editor"
        {...(leading === undefined ? {} : { toolbarLeading: leading })}
        {...(trailing === undefined ? {} : { toolbarTrailing: trailing })}
      />
    </TooltipProvider>
  );
}

describe('rich text toolbar slots', () => {
  it('puts the leading control on the same row as the formatting buttons', async () => {
    render(<Harness leading={<button type="button">Rich text</button>} />);

    const toolbar = await waitFor(() => screen.getByTestId('doc-rich-editor-toolbar'));
    expect(within(toolbar).getByRole('button', { name: 'Rich text' })).toBeDefined();
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toBeDefined();
    cleanup();
  });

  it('puts the trailing control on that same row', async () => {
    render(<Harness trailing={<span>Uploading 40%</span>} />);

    const toolbar = await waitFor(() => screen.getByTestId('doc-rich-editor-toolbar'));
    expect(within(toolbar).getByText('Uploading 40%')).toBeDefined();
    cleanup();
  });

  it('renders no extra separators when neither slot is used', async () => {
    render(<Harness />);

    const toolbar = await waitFor(() => screen.getByTestId('doc-rich-editor-toolbar'));
    expect(within(toolbar).queryByText('Rich text')).toBeNull();
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toBeDefined();
    cleanup();
  });
});
