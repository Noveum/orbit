import { publishDeltas } from '@orbit/core';
import {
  conflict,
  internal,
  isDomainError,
  notFound,
  unauthorized,
  validationFailed,
} from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { ORIGIN_CLIENT_ID_HEADER, originClientIdSchema } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { idSchema } from '@orbit/shared/validators';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import { resolveMembership } from '@/lib/auth/principal.ts';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { getSession, requireSession } from '@/lib/auth/session.ts';

export interface ApiContext extends MembershipContext {
  readonly userName: string;
  readonly userEmail: string;
}

interface ContextOptions {
  readonly allowDeleting?: boolean;
}

function assertWorkspaceAvailable(context: ApiContext, options: ContextOptions): void {
  if (context.deletionRequestedAt !== null && options.allowDeleting !== true) {
    throw conflict('Workspace deletion is in progress.');
  }
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
  };
}

export async function apiContext(options: ContextOptions = {}): Promise<ApiContext> {
  const session = await getSession();
  if (session === null) throw unauthorized();
  const context = await contextFor(session);
  if (context === null) throw unauthorized('You are not a member of any workspace.');
  assertWorkspaceAvailable(context, options);
  return context;
}

export async function pageContext(options: ContextOptions = {}): Promise<ApiContext> {
  const session = await requireSession();
  const context = await contextFor(session);
  if (context === null) redirect('/login');
  if (context.deletionRequestedAt !== null && options.allowDeleting !== true) {
    redirect('/settings/general');
  }
  return context;
}

function validationIssues(error: ZodError): {
  readonly code: string;
  readonly path: string[];
  readonly message: string;
}[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
    message: issue.message,
  }));
}

function toResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    const issues = validationIssues(error);
    return Response.json(
      {
        error: {
          code: 'validation_failed',
          message: issues[0]?.message ?? 'That request contains invalid fields.',
          details: { issues },
        },
      },
      { status: 422 },
    );
  }
  if (!isDomainError(error)) {
    console.error('A request failed on something the route did not expect.', error);
    const opaque = internal();
    return Response.json(opaque.toJSON(), { status: opaque.status });
  }
  return Response.json(error.toJSON(), { status: error.status });
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

async function originClientId(): Promise<string | null> {
  const parsed = originClientIdSchema.safeParse((await headers()).get(ORIGIN_CLIENT_ID_HEADER));
  return parsed.success ? parsed.data : null;
}

export async function publish(actions: readonly SyncAction[]): Promise<void> {
  if (actions.length === 0) return;
  try {
    const origin = await originClientId();
    const stamped =
      origin === null
        ? [...actions]
        : actions.map((action) => ({ ...action, originClientId: origin }));
    await publishDeltas(stamped);
  } catch (error: unknown) {
    console.error('Could not publish realtime deltas, the write is already committed.', error);
  }
}

const REVALIDATE_HEADERS = { 'cache-control': 'private, no-cache' } as const;

export async function cachedJson(
  request: Request,
  version: string,
  build: () => Promise<unknown>,
): Promise<Response> {
  const etag = `W/"${version}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, ...REVALIDATE_HEADERS } });
  }
  return Response.json(await build(), { headers: { etag, ...REVALIDATE_HEADERS } });
}

export async function readJson(request: Request): Promise<unknown> {
  const raw = await request.text().catch(() => {
    throw validationFailed('That request body could not be read.');
  });
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw validationFailed('That request body is not valid JSON.');
  }
}

export function routeId(value: string, what = 'record'): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound(`That ${what} does not exist.`);
  return parsed.data;
}

export function searchParamsOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}
