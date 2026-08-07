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

mock.module('@/features/docs/doc-people-access.tsx', () => ({
  DocPeopleAccess: () => null,
}));

mock.module('@/features/docs/doc-access-requests.tsx', () => ({
  DocAccessRequests: () => null,
}));

const { DocShareMenu, shareTrigger, visibleChoices } = await import(
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
    sortOrder: 0,
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

async function openShare(current: Doc, canPublish = true) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(menu(current, canPublish));
  await user.click(screen.getByTestId('doc-share'));
  return user;
}

function choiceFor(value: string): HTMLElement {
  return screen.getByTestId(`doc-visibility-${value}`);
}

function stubClipboard(): { value: string } {
  const captured = { value: '' };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (value: string) => {
        captured.value = value;
        return Promise.resolve();
      },
    },
  });
  return captured;
}

beforeEach(() => {
  shareMutate.mockClear();
});

describe('the share dialog', () => {
  it('says on the trigger what the doc is right now', () => {
    render(menu(doc('public', 'token_1')));

    expect(screen.getByTestId('doc-share')).toHaveTextContent('Public');
  });

  it('offers every visibility in one place, with no second menu', async () => {
    await openShare(doc('public', 'token_1'));

    for (const visibility of DOC_VISIBILITIES) {
      expect(choiceFor(visibility)).toBeInTheDocument();
    }
  });

  it('marks only the state the doc is actually in', async () => {
    await openShare(doc('workspace'));

    expect(choiceFor('workspace')).toHaveAttribute('aria-pressed', 'true');
    expect(choiceFor('private')).toHaveAttribute('aria-pressed', 'false');
    expect(choiceFor('link')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches visibility in one click', async () => {
    const user = await openShare(doc('workspace'));

    await user.click(choiceFor('private'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'private' });
  });

  it('never claims a public doc is the unlisted link, so public can still be narrowed', async () => {
    const user = await openShare(doc('public', 'token_1'));

    expect(choiceFor('link')).toHaveAttribute('aria-pressed', 'false');
    await user.click(choiceFor('link'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link' });
  });

  it('still moves when the choice already matches, so a click is never swallowed', async () => {
    const user = await openShare(doc('link', 'token_1'));

    await user.click(choiceFor('link'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link' });
  });

  it('hides the outside world from someone who cannot publish', async () => {
    await openShare(doc('workspace'), false);

    expect(screen.queryByTestId('doc-visibility-link')).toBeNull();
    expect(screen.queryByTestId('doc-visibility-public')).toBeNull();
    expect(choiceFor('private')).toBeInTheDocument();
    expect(visibleChoices(false).map((choice) => choice.value)).toEqual([
      'private',
      'team',
      'workspace',
    ]);
  });
});

describe('copying a link to a doc', () => {
  it('copies the in app link for a private doc, so a colleague can be pointed at it', async () => {
    const user = await openShare(doc('private'));
    const clipboard = stubClipboard();

    await user.click(screen.getByTestId('doc-copy-link'));

    expect(clipboard.value).toContain('/docs/doc_1');
  });

  it('copies the in app link for a workspace doc too', async () => {
    const user = await openShare(doc('workspace'));
    const clipboard = stubClipboard();

    await user.click(screen.getByTestId('doc-copy-link'));

    expect(clipboard.value).toContain('/docs/doc_1');
  });

  it('offers the published link alongside the workspace one once a doc is shared out', async () => {
    const user = await openShare(doc('link', 'token_1'));
    const clipboard = stubClipboard();

    await user.click(screen.getByTestId('doc-copy-public-link'));

    expect(clipboard.value).toContain('/d/delta-protocol-token_1');
  });

  it('keeps the public link and its reset out of sight while the doc has none', async () => {
    await openShare(doc('workspace'));

    expect(screen.queryByTestId('doc-copy-public-link')).toBeNull();
    expect(screen.queryByTestId('doc-rotate-link')).toBeNull();
  });

  it('resets the published link on request', async () => {
    const user = await openShare(doc('link', 'token_1'));

    await user.click(screen.getByTestId('doc-rotate-link'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link', rotateToken: true });
  });
});

describe('shareTrigger', () => {
  it('names each visibility in the words a person would use', () => {
    expect(shareTrigger('private')).toBe('Private');
    expect(shareTrigger('team')).toBe('Private');
    expect(shareTrigger('workspace')).toBe('Workspace');
    expect(shareTrigger('link')).toBe('Unlisted');
    expect(shareTrigger('public')).toBe('Public');
  });
});
