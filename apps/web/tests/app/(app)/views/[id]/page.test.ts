import { afterAll, describe, expect, it, mock } from 'bun:test';

const handlerModule = { ...(await import('@/lib/api/handler.ts')) };
const coreModule = { ...(await import('@orbit/core')) };

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({
      principal: { userId: 'user-1', organizationId: 'org', role: 'member', teamIds: [] },
    }),
}));
mock.module('@orbit/core', () => ({
  ...coreModule,
  listViews: () => Promise.resolve([{ id: 'view-1', name: 'Bugs this week' }]),
}));

const { generateMetadata } = await import('@/app/(app)/views/[id]/page.tsx');

afterAll(() => {
  mock.module('@/lib/api/handler.ts', () => handlerModule);
  mock.module('@orbit/core', () => coreModule);
});

describe('the saved view metadata', () => {
  it('titles the page and its share cards with the view name', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'view-1' }) });
    expect(meta.title).toBe('Bugs this week');
    expect(meta.openGraph?.title).toBe('Bugs this week · Orbit');
    expect(meta.twitter?.title).toBe('Bugs this week · Orbit');
    expect(meta.openGraph?.url).toBe('/views/view-1');
  });

  it('falls back to a generic title for a view the member cannot see', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'virtual%3Aall' }) });
    expect(meta.title).toBe('View');
    expect(meta.openGraph?.title).toBe('View · Orbit');
    expect(meta.openGraph?.url).toBe('/views/virtual%3Aall');
  });
});
