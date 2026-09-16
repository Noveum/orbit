import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createDoc, setDocAccess } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { mockSession } from '../../../../tests-support.ts';

const signedIn: { value: { user: { id: string } } | null } = { value: null };

mockSession(() => signedIn.value);

const route = await import('@/app/(app)/docs/[id]/artifact/route.ts');

const PAGE = '<!doctype html><title>Build record</title><p>All green</p>';

let workspace: Workspace;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

beforeEach(() => {
  signedIn.value = { user: { id: workspace.adminUser.id } };
});

async function page(visibility = 'workspace', kind = 'html') {
  const { doc } = await createDoc(workspace.admin, {
    visibility,
    kind,
    title: 'Build record',
    content: kind === 'html' ? PAGE : '# Build record',
  });
  return doc;
}

function contextFor(docId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: docId }) };
}

function request(): Request {
  return new Request('http://localhost:3000/docs/any/artifact');
}

describe('GET /docs/[id]/artifact', () => {
  it('serves the page to a member of the workspace', async () => {
    const doc = await page();

    const response = await route.GET(request(), contextFor(doc.id));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PAGE);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('sandboxes the page so it cannot act on the orbit origin', async () => {
    const doc = await page();

    const response = await route.GET(request(), contextFor(doc.id));

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp.startsWith('sandbox ')).toBe(true);
    expect(csp).not.toContain('allow-same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sends a signed-out visitor to sign in and back to the page', async () => {
    const doc = await page();
    signedIn.value = null;

    const response = await route.GET(request(), contextFor(doc.id));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `/login?next=${encodeURIComponent(`/docs/${doc.id}/artifact`)}`,
    );
  });

  it('has nothing to serve for a markdown doc', async () => {
    const doc = await page('workspace', 'markdown');

    const response = await route.GET(request(), contextFor(doc.id));

    expect(response.status).toBe(404);
  });

  it('refuses a reader from another workspace', async () => {
    const doc = await page();
    const other = await createWorkspace('Elsewhere');
    signedIn.value = { user: { id: other.adminUser.id } };

    const response = await route.GET(request(), contextFor(doc.id));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('All green');
  });

  it('opens a private page only once it is shared with the reader', async () => {
    const doc = await page('private');
    const invited = await addMember(workspace, 'member', { name: 'Ida Invited' });
    signedIn.value = { user: { id: invited.user.id } };

    expect((await route.GET(request(), contextFor(doc.id))).status).toBe(404);

    signedIn.value = { user: { id: workspace.adminUser.id } };
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: invited.user.id, level: 'read' }],
    });
    signedIn.value = { user: { id: invited.user.id } };

    expect((await route.GET(request(), contextFor(doc.id))).status).toBe(200);
  });
});
