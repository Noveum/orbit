import { resolveDocArtifact } from '@orbit/core';
import { isHtmlDoc } from '@orbit/shared/constants';
import { idSchema } from '@orbit/shared/validators';
import { getSession } from '@/lib/auth/session.ts';
import { htmlArtifactHeaders } from '@/lib/docs/html-artifact.ts';
import { docArtifactPath } from '@/lib/docs/paths.ts';
import { signInNextPath } from '@/lib/docs/published.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

function missing(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return missing();
  const docId = parsed.data;

  const session = await getSession();
  const result = await resolveDocArtifact(docId, session?.user.id ?? null);
  if (result.status === 'sign-in') {
    return new Response(null, {
      status: 302,
      headers: { location: signInNextPath(docArtifactPath(docId)) },
    });
  }
  if (result.status === 'missing' || !isHtmlDoc(result.doc.kind)) return missing();
  return new Response(result.doc.content, { headers: htmlArtifactHeaders() });
}
