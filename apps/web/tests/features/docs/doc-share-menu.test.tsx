import { beforeEach, describe, expect, it, mock } from 'bun:test';
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
    kind: 'markdown',
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

    expect(screen.getByTestId('doc-share')).toHaveTextContent('Share');
  });

  it('offers exactly three audiences without duplicate workspace or public choices', async () => {
    await openShare(doc('public', 'token_1'));

    for (const visibility of ['private', 'workspace', 'link']) {
      expect(choiceFor(visibility)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('doc-visibility-members')).toBeNull();
    expect(screen.queryByTestId('doc-visibility-public')).toBeNull();
  });

  it('marks only the state the doc is actually in', async () => {
    await openShare(doc('workspace'));

    expect(choiceFor('workspace')).toHaveAttribute('aria-pressed', 'true');
    expect(choiceFor('private')).toHaveAttribute('aria-pressed', 'false');
    expect(choiceFor('link')).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps team grants private until the author explicitly selects Workspace', async () => {
    const user = await openShare(doc('team'));
    expect(choiceFor('private')).toHaveAttribute('aria-pressed', 'true');
    expect(choiceFor('workspace')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('combobox', { name: 'Workspace access' })).toBeNull();
    await user.click(choiceFor('workspace'));
    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'workspace' });
  });

  it('switches visibility in one click', async () => {
    const user = await openShare(doc('workspace'));

    await user.click(choiceFor('private'));

    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'private' });
  });

  it('changes search indexing without introducing another public audience', async () => {
    const user = await openShare(doc('public', 'token_1'));
    expect(choiceFor('link')).toHaveAttribute('aria-pressed', 'true');
    await user.click(
      screen.getByRole('checkbox', { name: 'Allow search engines to find this page' }),
    );
    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'link' });
  });

  it('keeps the current permission when the selected audience is clicked', async () => {
    const user = await openShare(doc('members', 'token_1'));
    await user.click(choiceFor('workspace'));
    expect(shareMutate).not.toHaveBeenCalled();
  });

  it('changes workspace permissions inside the same audience without publishing permission', async () => {
    const user = await openShare(doc('workspace'), false);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace access' }), 'members');
    expect(shareMutate).toHaveBeenCalledWith({ visibility: 'members' });
  });

  it('hides the outside world from someone who cannot publish', async () => {
    await openShare(doc('workspace'), false);

    expect(screen.queryByTestId('doc-visibility-members')).toBeNull();
    expect(screen.queryByTestId('doc-visibility-link')).toBeNull();
    expect(screen.queryByTestId('doc-visibility-public')).toBeNull();
    expect(choiceFor('private')).toBeInTheDocument();
    expect(visibleChoices(false).map((choice) => choice.value)).toEqual(['private', 'workspace']);
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

  it('copies one public link once a doc is shared out', async () => {
    const user = await openShare(doc('link', 'token_1'));
    const clipboard = stubClipboard();

    await user.click(screen.getByTestId('doc-copy-link'));

    expect(clipboard.value).toContain('/d/delta-protocol-token_1');
  });

  it('uses the same workspace audience and document link for view-only access', async () => {
    const user = await openShare(doc('members', 'token_1'));
    const clipboard = stubClipboard();
    expect(choiceFor('workspace')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Workspace access' })).toHaveValue('members');
    expect(screen.queryByTestId('doc-rotate-link')).toBeNull();
    await user.click(screen.getByTestId('doc-copy-link'));
    expect(clipboard.value).toContain('/docs/doc_1');
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
    expect(shareTrigger('members')).toBe('Workspace');
    expect(shareTrigger('link')).toBe('Anyone with the link');
    expect(shareTrigger('public')).toBe('Anyone with the link');
  });
});

describe('sharing authority in the interface', () => {
  it('lets readers copy links but disables access changes and rotation', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <TooltipProvider>
        <DocShareMenu doc={doc('public', 'token')} canPublish canManageAccess={false} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId('doc-share'));
    expect(screen.getByTestId('doc-visibility-private')).toBeDisabled();
    expect(screen.getByTestId('doc-rotate-link')).toBeDisabled();
    expect(screen.getByTestId('doc-copy-link')).toBeEnabled();
  });
});

it('disables publishing and rotation after an author loses publishing permission', async () => {
  await openShare(doc('link', 'token'), false);
  expect(choiceFor('link')).toBeDisabled();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByTestId('doc-rotate-link')).toBeDisabled();
  expect(choiceFor('private')).not.toBeDisabled();
});
