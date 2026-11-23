import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { DocDetail } from '@orbit/core';
import { render, screen } from '@/test/render.tsx';

const publishedModule = { ...(await import('@/lib/docs/published.ts')) };

const detail: DocDetail = {
  doc: {
    id: 'doc_1',
    organizationId: 'org_1',
    collectionId: null,
    parentId: null,
    projectId: null,
    title: 'Launch readiness',
    slug: '',
    kind: 'markdown',
    content: '## In short\n\nMostly done.',
    revision: 1,
    sortOrder: 0,
    visibility: 'link',
    publishToken: 'token1',
    authorId: 'user_1',
    repoBinding: null,
    syncId: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
  },
  attachments: [],
  author: { id: 'user_1', name: 'Sam Rivera', image: null },
  followers: 1,
  backlinks: [],
  access: 'read',
};

mock.module('@/lib/docs/published.ts', () => ({
  ...publishedModule,
  loadPublishedDoc: () => Promise.resolve(detail),
}));

const { default: PublishedDocPage } = await import('@/app/d/[token]/page.tsx');

afterAll(() => {
  mock.module('@/lib/docs/published.ts', () => publishedModule);
});

describe('PublishedDocPage', () => {
  it('shows the published doc at full width regardless of the stored reading width', async () => {
    render(await PublishedDocPage({ params: Promise.resolve({ token: 'token1' }) }));

    const reader = await screen.findByTestId('doc-reader');
    expect(reader).toHaveAttribute('data-reading-width', 'full');
    expect(reader.className).toContain('max-w-none');
  });
});
