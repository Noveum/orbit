import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  buildIssueRoutesWorld,
  forgetObjects,
  forgetUploads,
  type IssueRoutesWorld,
  installRouteMocks,
  signInAs,
  storeObject,
} from '../../../../../tests-support-issue-routes.ts';

const route = await import('../../../../../src/app/api/attachments/html/[...key]/route.ts');

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
    status: 'ready',
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
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('sandboxes the page so it cannot reach the orbit origin', async () => {
    const storageKey = await attach({ commentId: world.openCommentId });

    const response = await route.GET(request(), contextFor(storageKey));

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp.startsWith('sandbox ')).toBe(true);
    expect(csp).not.toContain('allow-same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
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

  it('refuses a page too large to buffer', async () => {
    const storageKey = await attach({
      commentId: world.openCommentId,
      size: route.MAX_HTML_PREVIEW_BYTES + 1,
    });

    const response = await route.GET(request(), contextFor(storageKey));

    expect(response.status).toBe(413);
  });

  it('is a not found when no attachment owns the key', async () => {
    const response = await route.GET(request(), contextFor('org/missing/page.html'));

    expect(response.status).toBe(404);
  });
});
