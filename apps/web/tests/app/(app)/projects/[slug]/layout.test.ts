import { afterAll, describe, expect, it, mock } from 'bun:test';

const handlerModule = { ...(await import('@/lib/api/handler.ts')) };
const dataModule = { ...(await import('@/features/projects/data.ts')) };

let lookup: () => Promise<unknown> = () => Promise.resolve(null);

mock.module('@/lib/api/handler.ts', () => ({
  ...handlerModule,
  pageContext: () =>
    Promise.resolve({
      principal: { userId: 'user-1', organizationId: 'org', role: 'member', teamIds: [] },
    }),
}));
mock.module('@/features/projects/data.ts', () => ({
  ...dataModule,
  findProjectDetail: () => lookup(),
}));

const { generateMetadata } = await import('@/app/(app)/projects/[slug]/layout.tsx');

afterAll(() => {
  mock.module('@/lib/api/handler.ts', () => handlerModule);
  mock.module('@/features/projects/data.ts', () => dataModule);
});

function metadataFor(slug: string) {
  return generateMetadata({ params: Promise.resolve({ slug }), children: null });
}

describe('the project layout metadata', () => {
  it('titles the page and its share cards with the project name', async () => {
    lookup = () => Promise.resolve({ summary: { name: 'Mobile launch' } });
    const meta = await metadataFor('mobile-launch');
    expect(meta.title).toBe('Mobile launch');
    expect(meta.openGraph?.title).toBe('Mobile launch · Orbit');
    expect(meta.twitter?.title).toBe('Mobile launch · Orbit');
    expect(meta.openGraph?.url).toBe('/projects/mobile-launch');
  });

  it('falls back to the slug when the project is missing', async () => {
    lookup = () => Promise.resolve(null);
    const meta = await metadataFor('gone');
    expect(meta.title).toBe('gone');
    expect(meta.openGraph?.title).toBe('gone · Orbit');
  });

  it('falls back to the slug instead of throwing when the lookup fails', async () => {
    lookup = () => Promise.reject(new Error('database down'));
    const meta = await metadataFor('broken');
    expect(meta.title).toBe('broken');
    expect(meta.twitter?.title).toBe('broken · Orbit');
  });
});
