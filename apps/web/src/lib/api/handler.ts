import { publishDeltas } from '@orbit/core';
import { toDomainError, unauthorized } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import { resolveMembership } from '@/lib/auth/principal.ts';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { getSession, requireSession } from '@/lib/auth/session.ts';

export interface ApiContext extends MembershipContext {
  readonly userName: string;
  readonly userEmail: string;
  readonly sessionToken: string;
}

async function contextFor(session: ActiveSession): Promise<ApiContext | null> {
  const membership = await resolveMembership(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );
  if (membership === null) return null;
  return {
    ...membership,
    userName: session.user.name,
    userEmail: session.user.email,
    sessionToken: session.session.token,
  };
}

export async function apiContext(): Promise<ApiContext> {
  const session = await getSession();
  if (session === null) throw unauthorized();
  const context = await contextFor(session);
  if (context === null) throw unauthorized('You are not a member of any workspace.');
  return context;
}

export async function pageContext(): Promise<ApiContext> {
  const session = await requireSession();
  const context = await contextFor(session);
  if (context === null) redirect('/login');
  return context;
}

function toResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.' } },
      { status: 422 },
    );
  }
  const domain = toDomainError(error);
  return Response.json(domain.toJSON(), { status: domain.status });
}

export function errorResponse(error: unknown): Response {
  return toResponse(error);
}

export async function handleRoute(run: () => Promise<unknown>): Promise<Response> {
  try {
    const payload = await run();
    if (payload instanceof Response) return payload;
    return Response.json(payload ?? { ok: true });
  } catch (error) {
    return toResponse(error);
  }
}

export async function handle<T>(run: (principal: Principal) => Promise<T>): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    return await run(context.principal);
  });
}

export async function publish(actions: readonly SyncAction[]): Promise<void> {
  await publishDeltas([...actions]);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function searchParamsOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}
