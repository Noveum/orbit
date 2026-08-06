import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { DOC_VISIBILITIES } from '@orbit/shared/constants';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { Doc } from '@/lib/query/schemas.ts';
import * as docsQuery from '@/lib/query/use-docs.ts';

const shareMutate = mock();

mock.module('@/lib/query/use-docs.ts', () => ({
  ...docsQuery,
  useShareDoc: () => ({ mutate: shareMutate, isPending: false }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

const { DocShareMenu, VISIBILITY_SEGMENTS, visibleSegments } = await import(
  '../../../src/features/docs/doc-share-menu.tsx'
);

function doc(visibility: string, publishToken: string | null = null): Doc {
  return {
    id: 'doc_1',
    organizationId: 'org_1',
    collectionId: null,
    projectId: null,
    parentId: null,
    title: 'Delta protocol',
    slug: 'delta-protocol',
    content: '',
    visibility,
    publishToken,
    authorId: 'user_1',
    repoBinding: null,
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  };
}

function menu(current: Doc, canPublish = true) {
  return (
    <TooltipProvider>
      <DocShareMenu doc={current} canPublish={canPublish} canManageAccess />
    </TooltipProvider>
  );
}

function segmentFor(value: string): HTMLElement {
  return screen.getByTestId(`doc-visibility-segment-${value}`);
}

beforeEach(() => {
  shareMutate.mockClear();
});

describe('the visibility control on a doc', () => {
  it('shows private, workspace and a shareable link without opening a menu', () => {
    render(menu(doc('workspace')));

    expect(screen.getByTestId('doc-visibility-control')).toBeInTheDocument();
    expect(VISIBILITY_SEGMENTS.map((segment) => segment.value)).toEqual([
      'private',
      'workspace',
      'link',
    ]);
    for (const segment of VISIBILITY_SEGMENTS) {
      expect(segmentFor(segment.value)).toBeInTheDocument();
    }
  });

  it('marks only the state the doc is actually in', () => {
    render(menu(doc('workspace')));

    expect(segmentFor('workspace')).toHaveAttribute('aria-pressed', 'true');
    expect(segmentFor('private')).toHaveAttribute('aria-pressed', 'false');
    expect(segmentFor('link')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches visibility in one click', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(menu(doc('workspace')));

    await user.click(segmentFor('private'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'private' });
  });

  it('never claims a public doc is the unlisted link, so public can still be narrowed', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(menu(doc('public', 'token_1')));

    expect(segmentFor('link')).toHaveAttribute('aria-pressed', 'false');

    await user.click(segmentFor('link'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link' });
  });

  it('still moves when the segment already matches, so a click is never swallowed', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(menu(doc('link', 'token_1')));

    await user.click(segmentFor('link'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link' });
  });

  it('hides the link segment from someone who cannot publish', () => {
    render(menu(doc('workspace'), false));

    expect(screen.queryByTestId('doc-visibility-segment-link')).toBeNull();
    expect(segmentFor('private')).toBeInTheDocument();
    expect(segmentFor('workspace')).toBeInTheDocument();
    expect(visibleSegments(false).map((segment) => segment.value)).toEqual([
      'private',
      'workspace',
    ]);
  });

  it('offers a copy control beside the doc once a link exists', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(menu(doc('link', 'token_1')));

    const copyButton = screen.getByTestId('doc-share-copy');
    expect(copyButton).toBeInTheDocument();

    let copiedValue = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copiedValue = value;
          return Promise.resolve();
        },
      },
    });

    await user.click(copyButton);

    expect(copiedValue).toContain('/d/delta-protocol-token_1');
  });

  it('keeps no copy control while the doc has no link', () => {
    render(menu(doc('workspace')));

    expect(screen.queryByTestId('doc-share-copy')).toBeNull();
  });
});

describe('the full set of visibility choices', () => {
  it('keeps every transition reachable from the doc header', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(menu(doc('public', 'token_1')));

    await user.click(screen.getByTestId('doc-publish'));

    for (const visibility of DOC_VISIBILITIES) {
      expect(screen.getByTestId(`doc-visibility-${visibility}`)).toBeInTheDocument();
    }
  });

  it('says what the doc is right now on the trigger', () => {
    render(menu(doc('public', 'token_1')));

    expect(screen.getByTestId('doc-publish')).toHaveTextContent('Public');
  });
});
