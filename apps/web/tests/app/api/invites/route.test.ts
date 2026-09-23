import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createInvite } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { mockSession } from '../../../../tests-support.ts';

let workspace: Workspace;
let signedIn = true;
const originalKey = process.env['RESEND_API_KEY'];

mockSession(() =>
  signedIn
    ? {
        user: { id: workspace.admin.userId, name: 'Admin', email: 'admin@orbit.test' },
        session: { activeOrganizationId: workspace.organizationId },
      }
    : null,
);

const { POST } = await import('../../../../src/app/api/invites/route.ts');
const { POST: resend } = await import('../../../../src/app/api/invites/[id]/resend/route.ts');

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Email configuration');
  delete process.env['RESEND_API_KEY'];
  signedIn = true;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env['RESEND_API_KEY'];
  else process.env['RESEND_API_KEY'] = originalKey;
});

function request(): Request {
  return new Request('http://localhost:3000/api/invites', {
    method: 'POST',
    body: JSON.stringify({ invites: [{ email: 'teammate@example.com' }] }),
  });
}

describe('email invitation preflight', () => {
  it('rejects missing email configuration without creating an invitation', async () => {
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('Email delivery is unavailable');
    expect(await db.select().from(schema.invitation)).toEqual([]);
  });

  it('does not extend an invitation when resend cannot deliver', async () => {
    const { invitation } = await createInvite(workspace.admin, { email: 'teammate@example.com' });
    const response = await resend(request(), { params: Promise.resolve({ id: invitation.id }) });
    expect(response.status).toBe(422);
    const [stored] = await db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.id, invitation.id));
    expect(stored?.expiresAt).toEqual(invitation.expiresAt);
    expect(stored?.syncId).toBe(invitation.syncId);
  });

  it('authenticates before revealing configuration requirements', async () => {
    signedIn = false;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('RESEND_API_KEY');
  });
});
