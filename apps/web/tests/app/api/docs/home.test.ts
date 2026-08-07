import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { forbidden } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { docFavoriteSchema } from '@orbit/shared/validators';
import { z } from 'zod';

const coreModule = await import('@orbit/core');

interface HomeCall {
  readonly input: unknown;
}

interface VisitCall {
  readonly docId: string;
}

interface FavoriteCall {
  readonly docId: string;
  readonly input: unknown;
}

const homeCalls: HomeCall[] = [];
const visitCalls: VisitCall[] = [];
const favoriteCalls: FavoriteCall[] = [];
const published: SyncAction[][] = [];

let visitRefuses = false;

const favoriteAction = {
  syncId: 9,
  organizationId: 'org_1',
  scopes: ['user:user_1'],
  action: 'update',
  model: 'doc',
  modelId: 'doc_1',
  data: {},
} as unknown as SyncAction;

mock.module('@orbit/core', () => ({
  ...coreModule,
  docsHome: (_principal: Principal, input: unknown) => {
    homeCalls.push({ input });
    return Promise.resolve({
      recent: [
        {
          id: 'doc_1',
          title: 'Runbook',
          collectionId: null,
          projectId: null,
          authorId: 'user_1',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      favorites: [],
      updated: [],
    });
  },
  recordDocVisit: (_principal: Principal, docId: string) => {
    visitCalls.push({ docId });
    if (visitRefuses) return Promise.reject(forbidden('Nope.'));
    return Promise.resolve({ id: docId });
  },
  setDocFavorite: (_principal: Principal, docId: string, input: unknown) => {
    favoriteCalls.push({ docId, input });
    const { favorite } = docFavoriteSchema.parse(input);
    return Promise.resolve({ docId, favorite, actions: [favoriteAction] });
  },
  publishDeltas: (actions: SyncAction[]) => {
    published.push(actions);
    return Promise.resolve();
  },
}));

const session = {
  user: { id: 'user_1', name: 'Ada Admin', email: 'ada@orbit.test' },
  session: { activeOrganizationId: 'org_1' },
};

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(session),
  requireSession: () => Promise.resolve(session),
}));

const principal: Principal = {
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'member',
  teamIds: ['team_1'],
};

mock.module('@/lib/auth/principal.ts', () => ({
  resolveMembership: () =>
    Promise.resolve({
      principal,
      memberId: 'member_1',
      organizationName: 'Nova',
      organizationSlug: 'nova',
    }),
}));

const { GET } = await import('../../../../src/app/api/docs/home/route.ts');
const { POST: VISIT } = await import('../../../../src/app/api/docs/[id]/visit/route.ts');
const { POST: FAVORITE } = await import('../../../../src/app/api/docs/[id]/favorite/route.ts');

const homeSchema = z.object({
  recent: z.array(z.object({ id: z.string(), title: z.string() })),
  favorites: z.array(z.unknown()),
  updated: z.array(z.unknown()),
});

beforeEach(() => {
  homeCalls.length = 0;
  visitCalls.length = 0;
  favoriteCalls.length = 0;
  published.length = 0;
  visitRefuses = false;
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

describe('GET /api/docs/home', () => {
  it('answers with the three shelves the home pane reads', async () => {
    const response = await GET(new Request('http://localhost:3000/api/docs/home'));
    const payload = homeSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.recent.map((entry) => entry.title)).toEqual(['Runbook']);
  });

  it('passes the query string through so a caller can ask for fewer', async () => {
    await GET(new Request('http://localhost:3000/api/docs/home?limit=3'));

    expect(homeCalls).toEqual([{ input: { limit: '3' } }]);
  });
});

describe('POST /api/docs/[id]/visit', () => {
  it('records a visit against the doc named in the path', async () => {
    const response = await VISIT(new Request('http://localhost:3000/api/docs/doc_1/visit'), {
      params: Promise.resolve({ id: 'doc_1' }),
    });

    expect(response.status).toBe(200);
    expect(visitCalls).toEqual([{ docId: 'doc_1' }]);
  });

  it('answers with the service refusal rather than swallowing it', async () => {
    visitRefuses = true;
    const response = await VISIT(new Request('http://localhost:3000/api/docs/doc_1/visit'), {
      params: Promise.resolve({ id: 'doc_1' }),
    });

    expect(response.status).toBe(403);
  });

  it('turns away an id no doc could carry before the service is asked', async () => {
    const statuses: number[] = [];
    for (const id of ['', 'd'.repeat(65)]) {
      const response = await VISIT(new Request('http://localhost:3000/api/docs/x/visit'), {
        params: Promise.resolve({ id }),
      });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([404, 404]);
    expect(visitCalls).toEqual([]);
  });
});

describe('POST /api/docs/[id]/favorite', () => {
  it('hands the flag to the service and fans the change out', async () => {
    const response = await FAVORITE(
      new Request('http://localhost:3000/api/docs/doc_1/favorite', {
        method: 'POST',
        body: JSON.stringify({ favorite: true }),
      }),
      { params: Promise.resolve({ id: 'doc_1' }) },
    );

    expect(response.status).toBe(200);
    expect(favoriteCalls).toEqual([{ docId: 'doc_1', input: { favorite: true } }]);
    expect(published).toEqual([[favoriteAction]]);
  });

  it('turns away an id no doc could carry before the service is asked', async () => {
    const statuses: number[] = [];
    for (const id of ['', 'd'.repeat(65)]) {
      const response = await FAVORITE(
        new Request('http://localhost:3000/api/docs/x/favorite', {
          method: 'POST',
          body: JSON.stringify({ favorite: true }),
        }),
        { params: Promise.resolve({ id }) },
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([404, 404]);
    expect(favoriteCalls).toEqual([]);
    expect(published).toEqual([]);
  });

  it('reports a body the validator rejects as a 422, not as a server fault', async () => {
    const response = await FAVORITE(
      new Request('http://localhost:3000/api/docs/doc_1/favorite', {
        method: 'POST',
        body: JSON.stringify({ favorite: 'yes' }),
      }),
      { params: Promise.resolve({ id: 'doc_1' }) },
    );

    expect(response.status).toBe(422);
    expect(published).toEqual([]);
  });
});
