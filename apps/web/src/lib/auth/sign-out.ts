import { publishSessionRevoked } from '@orbit/core';
import { auth } from './server.ts';

const SIGN_OUT_PATH = '/api/auth/sign-out';

export function isSignOutRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== 'POST') return false;
  try {
    return new URL(request.url).pathname.replace(/\/+$/, '').endsWith(SIGN_OUT_PATH);
  } catch {
    return false;
  }
}

export async function withSocketRevocation(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!isSignOutRequest(request)) return await handle(request);

  const session = await auth.api.getSession({ headers: request.headers });
  const response = await handle(request);
  const userId = session?.user.id;
  if (userId === undefined || !response.ok) return response;
  await publishSessionRevoked(userId);
  return response;
}
