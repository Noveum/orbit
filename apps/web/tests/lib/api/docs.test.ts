import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Principal } from '@orbit/shared/policy';

const coreModule = await import('@orbit/core');

interface Row {
  readonly excerpt: string;
  readonly snippet: string;
  readonly titleMatch: boolean;
  readonly publishToken: string | null;
}

let rows: Row[] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  listDocs: () => Promise.resolve(rows),
  listDocCollections: () => Promise.resolve([]),
}));

const { docListPayload } = await import('../../../src/lib/api/docs.ts');

const principal: Principal = {
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'member',
  teamIds: [],
};

function row(overrides: Partial<Row>): Row {
  return { excerpt: '', snippet: '', titleMatch: false, publishToken: null, ...overrides };
}

beforeEach(() => {
  rows = [];
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

describe('docListPayload', () => {
  it('carries the matching passage as plain text, separate from the head excerpt', async () => {
    rows = [
      row({
        excerpt: '# Deploy runbook\n\nThe head of the doc.',
        snippet: '…waits on a **quorum** handshake before traffic moves.',
      }),
    ];

    const payload = await docListPayload(principal);

    expect(payload.docs[0]?.snippet).toBe('…waits on a quorum handshake before traffic moves.');
    expect(payload.docs[0]?.excerpt).toBe('Deploy runbook The head of the doc.');
  });

  it('leaves the passage empty when nothing in the body matched', async () => {
    rows = [row({ excerpt: 'Some head text.', titleMatch: true })];

    const payload = await docListPayload(principal);

    expect(payload.docs[0]?.snippet).toBe('');
    expect(payload.docs[0]?.titleMatch).toBe(true);
  });

  it('never lets a publish token out through the list', async () => {
    rows = [row({ publishToken: 'secret-token' })];

    const payload = await docListPayload(principal);

    expect(payload.docs[0]?.publishToken).toBe('set');
  });
});
