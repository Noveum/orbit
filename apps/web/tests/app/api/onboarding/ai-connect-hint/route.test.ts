import { beforeEach, describe, expect, it } from 'bun:test';
import { createUser, resetDatabase } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { mockSession } from '../../../../../tests-support.ts';

let callerId: string | null = null;

mockSession(() => (callerId === null ? null : { user: { id: callerId }, session: {} }));

const { DELETE } = await import('../../../../../src/app/api/onboarding/ai-connect-hint/route.ts');

async function stateOf(userId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ state: schema.user.onboardingState })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return (row?.state ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  await resetDatabase();
  callerId = null;
});

describe('DELETE /api/onboarding/ai-connect-hint', () => {
  it('records the dismissal on the signed-in user', async () => {
    const user = await createUser('Nia New');
    callerId = user.id;
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dismissed: true });
    expect((await stateOf(user.id))['aiConnectHintDismissed']).toBe(true);
  });

  it('refuses a request without a session and changes nothing', async () => {
    const user = await createUser('Nia New');
    const response = await DELETE();
    expect(response.status).toBe(401);
    expect((await stateOf(user.id))['aiConnectHintDismissed']).toBeUndefined();
  });
});
