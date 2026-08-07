import { afterEach, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cleanup, render, screen, waitFor } from '@/test/render.tsx';
import { DocExportItems } from '../../../src/features/docs/doc-export-menu.tsx';

const createdUrl = 'blob:orbit/export';
const anchors: { href: string; download: string; clicked: boolean }[] = [];

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const originalPrint = window.print;
const originalCreateElement = document.createElement.bind(document);

function trackAnchors(): void {
  URL.createObjectURL = mock(() => createdUrl) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = mock(() => undefined) as unknown as typeof URL.revokeObjectURL;
  document.createElement = ((tag: string) => {
    const node = originalCreateElement(tag);
    if (tag === 'a') {
      const record = { href: '', download: '', clicked: false };
      anchors.push(record);
      Object.defineProperty(node, 'href', {
        get: () => record.href,
        set: (value: string) => {
          record.href = value;
        },
      });
      Object.defineProperty(node, 'download', {
        get: () => record.download,
        set: (value: string) => {
          record.download = value;
        },
      });
      node.click = () => {
        record.clicked = true;
      };
    }
    return node;
  }) as typeof document.createElement;
}

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  window.print = originalPrint;
  document.createElement = originalCreateElement;
  anchors.length = 0;
});

const user = userEvent.setup({ pointerEventsCheck: 0 });

function exportMenu(title: string, content: string) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>More</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DocExportItems title={title} content={content} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function openMenu(): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await screen.findByTestId('doc-export');
  await user.keyboard('{ArrowDown}{ArrowRight}');
  await waitFor(() => expect(screen.getByTestId('doc-export-markdown')).toBeTruthy());
}

describe('exporting a doc', () => {
  it('downloads markdown named after the doc', async () => {
    trackAnchors();
    render(exportMenu('Deploy runbook', 'How we ship.'));
    await openMenu();

    await user.click(screen.getByTestId('doc-export-markdown'));

    await waitFor(() => expect(anchors.some((entry) => entry.clicked)).toBe(true));
    const used = anchors.find((entry) => entry.clicked);
    expect(used?.download).toBe('deploy-runbook.md');
    expect(used?.href).toBe(createdUrl);
  });

  it('hands PDF to the browser print dialog rather than rendering one', async () => {
    const print = mock(() => undefined);
    window.print = print as unknown as typeof window.print;
    render(exportMenu('Deploy runbook', 'How we ship.'));
    await openMenu();

    await user.click(screen.getByTestId('doc-export-pdf'));
    await waitFor(() => expect(print).toHaveBeenCalled());
  });
});
