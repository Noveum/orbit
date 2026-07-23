import { conflict, unauthorized } from '@orbit/shared/errors';
import { credentialRemoveSchema } from '@orbit/shared/validators';
import { headers } from 'next/headers';
import { canRemoveSignInMethod, LAST_CREDENTIAL_MESSAGE } from '@/features/account/credentials.ts';
import { handleRoute, readJson } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';

export async function DELETE(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session === null) throw unauthorized();

    const parsed = credentialRemoveSchema.parse(await readJson(request));
    const [accounts, passkeys] = await Promise.all([
      auth.api.listUserAccounts({ headers: requestHeaders }),
      auth.api.listPasskeys({ headers: requestHeaders }),
    ]);

    if (!canRemoveSignInMethod({ accounts: accounts.length, passkeys: passkeys.length })) {
      throw conflict(LAST_CREDENTIAL_MESSAGE);
    }

    if (parsed.kind === 'passkey') {
      await auth.api.deletePasskey({ headers: requestHeaders, body: { id: parsed.id } });
      return { removed: 'passkey' };
    }

    await auth.api.unlinkAccount({
      headers: requestHeaders,
      body: {
        providerId: parsed.providerId,
        ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
      },
    });
    return { removed: 'account' };
  });
}
