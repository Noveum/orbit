import { beforeEach, describe, expect, it } from 'bun:test';
import {
  decideDocAccessRequest,
  docGateway,
  listDocAccessRequests,
  requestDocAccess,
} from '../../src/content/doc-access-request-service.ts';
import { createDoc, getDoc } from '../../src/content/doc-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function privateDoc(title = 'Severance terms') {
  const { doc } = await createDoc(workspace.admin, {
    title,
    content: 'Numbers nobody else should read.',
    visibility: 'private',
  });
  return doc;
}

describe('docGateway', () => {
  it('names the doc and its owner without leaking the body', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });

    const gateway = await docGateway(outsider.principal, doc.id);

    expect(gateway.title).toBe('Severance terms');
    expect(gateway.ownerName.length).toBeGreaterThan(0);
    expect(gateway.requested).toBe(false);
    expect(gateway).not.toHaveProperty('content');
  });

  it('refuses somebody who can already read the doc', async () => {
    const doc = await privateDoc();

    await expect(docGateway(workspace.admin, doc.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reports that a request is already pending', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    await requestDocAccess(outsider.principal, doc.id, {});

    expect((await docGateway(outsider.principal, doc.id)).requested).toBe(true);
  });
});

describe('requestDocAccess', () => {
  it('records the request and tells the owner', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });

    const { request, actions } = await requestDocAccess(outsider.principal, doc.id, {
      message: 'I am picking up the payroll work.',
    });

    expect(request.status).toBe('pending');
    expect(request.requesterId).toBe(outsider.user.id);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('refuses a second pending request from the same person', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    await requestDocAccess(outsider.principal, doc.id, {});

    await expect(requestDocAccess(outsider.principal, doc.id, {})).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('decideDocAccessRequest', () => {
  it('grants read access and lets the requester open the doc', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { request } = await requestDocAccess(outsider.principal, doc.id, {});

    const { request: decided } = await decideDocAccessRequest(workspace.admin, request.id, {
      grant: true,
    });

    expect(decided.status).toBe('granted');
    const detail = await getDoc(outsider.principal, doc.id);
    expect(detail.doc.id).toBe(doc.id);
    expect(detail.access).toBe('read');
  });

  it('declines without granting anything', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { request } = await requestDocAccess(outsider.principal, doc.id, {});

    const { request: decided } = await decideDocAccessRequest(workspace.admin, request.id, {
      grant: false,
    });

    expect(decided.status).toBe('declined');
    await expect(getDoc(outsider.principal, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a member who neither wrote the doc nor runs the workspace', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const { doc } = await createDoc(author.principal, { title: 'Theirs', visibility: 'private' });
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    const bystander = await addMember(workspace, 'member', { name: 'Ben Bystander' });
    const { request } = await requestDocAccess(outsider.principal, doc.id, {});

    await expect(
      decideDocAccessRequest(bystander.principal, request.id, { grant: true }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses to answer the same request twice', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { request } = await requestDocAccess(outsider.principal, doc.id, {});
    await decideDocAccessRequest(workspace.admin, request.id, { grant: true });

    await expect(
      decideDocAccessRequest(workspace.admin, request.id, { grant: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('listDocAccessRequests', () => {
  it('shows the owner who is waiting', async () => {
    const doc = await privateDoc();
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    await requestDocAccess(outsider.principal, doc.id, {});

    const pending = await listDocAccessRequests(workspace.admin, doc.id);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.requesterId).toBe(outsider.user.id);
  });

  it('refuses somebody who does not own the doc', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const { doc } = await createDoc(author.principal, { title: 'Theirs', visibility: 'private' });
    const bystander = await addMember(workspace, 'member', { name: 'Ben Bystander' });

    await expect(listDocAccessRequests(bystander.principal, doc.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
