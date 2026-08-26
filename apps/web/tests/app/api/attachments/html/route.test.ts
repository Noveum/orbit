import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { MAX_HTML_PREVIEW_BYTES } from '@/lib/docs/html-artifact.ts';
import {
  buildIssueRoutesWorld,
  forgetObjects,
  forgetUploads,
  type IssueRoutesWorld,
  installRouteMocks,
  signInAs,
  storeObject,
  storeObjectBytes,
} from '../../../../../tests-support-issue-routes.ts';

const route = await import('@/app/api/attachments/html/[...key]/route.ts');

const PAGE = '<!doctype html><title>Sync health</title><p>All green</p>';

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
  forgetUploads();
  forgetObjects();
});

async function attach(input: {
  readonly commentId: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly status?: string;
}): Promise<string> {
  const storageKey = `org/${randomUUIDv7()}/page.html`;
  await db.insert(schema.attachment).values({
    id: randomUUIDv7(),
    organizationId: world.workspace.organizationId,
    parentType: 'comment',
    parentId: input.commentId,
    fileName: 'page.html',
    contentType: input.contentType ?? 'text/html',
    size: input.size ?? PAGE.length,
    storageKey,
    status: input.status ?? 'ready',
    uploadedById: world.admin.userId,
  });
  storeObject(storageKey, PAGE);
  return storageKey;
}

function contextFor(storageKey: string): { params: Promise<{ key: string[] }> } {
  return { params: Promise.resolve({ key: storageKey.split('/') }) };
}

function request(): Request {
  return new Request('http://localhost:3000/api/attachments/html/org/key/page.html');
}

describe('GET /api/attachments/html/[...key]', () => {
  it('serves an html attachment the caller can read', async () => {
    const storageKey = await attach({ commentId: world.openCommentId });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PAGE);
    expect(response.headers.get('content-type')).toBe('text/html');
  });

  it('keeps an xhtml page on its own content type', async () => {
    const storageKey = await attach({
      commentId: world.openCommentId,
      contentType: 'application/xhtml+xml',
    });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xhtml+xml');
  });

  it('sandboxes the page so it cannot reach the orbit origin', async () => {
    const storageKey = await attach({ commentId: world.openCommentId });

    const response = await route.GET(request(), contextFor(storageKey));

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp.startsWith('sandbox ')).toBe(true);
    expect(csp).not.toContain('allow-same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('refuses an attachment on a comment the caller cannot see', async () => {
    const storageKey = await attach({ commentId: world.hiddenCommentId });
    signInAs(world.outsider);

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('All green');
  });

  it('refuses to render a file that is not html', async () => {
    const storageKey = await attach({
      commentId: world.openCommentId,
      contentType: 'text/plain',
    });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(404);
  });

  it('refuses a page whose recorded size is over the cap', async () => {
    const storageKey = await attach({
      commentId: world.openCommentId,
      size: MAX_HTML_PREVIEW_BYTES + 1,
    });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(413);
  });

  it('refuses a page whose stored bytes exceed the cap the row understated', async () => {
    const storageKey = await attach({ commentId: world.openCommentId });
    storeObjectBytes(storageKey, new Uint8Array(MAX_HTML_PREVIEW_BYTES + 1));

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(413);
  });

  it('serves the stored bytes untouched so a page is not re-encoded', async () => {
    const storageKey = await attach({ commentId: world.openCommentId });
    const latin1 = new Uint8Array([0x3c, 0x70, 0x3e, 0xe9, 0x74, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
    storeObjectBytes(storageKey, latin1);

    const response = await route.GET(request(), contextFor(storageKey));

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(latin1);
  });

  it('refuses an upload that never completed', async () => {
    const storageKey = await attach({ commentId: world.openCommentId, status: 'pending' });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('All green');
  });

  it('is a not found when no attachment owns the key', async () => {
    const response = await route.GET(request(), contextFor('org/missing/page.html'));

    expect(response.status).toBe(404);
  });
});
