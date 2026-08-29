import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { HTML_PAGE_TEMPLATE_ID } from '@/features/docs/templates.ts';
import { newDocPath } from '@/lib/docs/paths.ts';
import type { Doc } from '@/lib/query/schemas.ts';
import { cleanup, render, screen } from '@/test/render.tsx';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['next/navigation', '@/features/docs/doc-header.tsx']);

const push = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { DocHeader } = await import('@/features/docs/doc-header.tsx');

const doc: Doc = {
  id: 'doc_1',
  organizationId: 'org_1',
  collectionId: 'collection_1',
  projectId: 'project_1',
  parentId: null,
  title: 'Delta protocol',
  slug: 'delta-protocol',
  kind: 'markdown',
  content: '',
  sortOrder: 0,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

function header(canWrite: boolean) {
  return (
    <TooltipProvider>
      <DocHeader
        doc={doc}
        trail={[]}
        collections={[]}
        favorite={false}
        canWrite={canWrite}
        canWriteDocs
        saveStatus={null}
        saveFailed={false}
        onToggleTree={mock()}
        onToggleFavorite={mock()}
        onMoveToCollection={mock()}
        onDuplicate={mock()}
        onOpenNestPicker={mock()}
        onOpenHistory={mock()}
        onArchive={mock()}
        onNewDoc={mock()}
        share={null}
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  push.mockClear();
});

afterEach(cleanup);

describe('DocHeader HTML creation', () => {
  it('opens the HTML page template in the current collection and project', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(header(true));

    await user.click(screen.getByTestId('doc-overflow'));
    await user.click(await screen.findByTestId('doc-new-html'));

    expect(push).toHaveBeenCalledWith(
      newDocPath({
        collectionId: doc.collectionId,
        projectId: doc.projectId,
        templateId: HTML_PAGE_TEMPLATE_ID,
      }),
    );
  });

  it('hides the HTML page action without write permission', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(header(false));

    await user.click(screen.getByTestId('doc-overflow'));

    expect(screen.queryByTestId('doc-new-html')).toBeNull();
  });
});
