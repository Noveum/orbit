import { resolveDocArtifact } from '@orbit/core';
import { isHtmlDoc } from '@orbit/shared/constants';
import { getSession } from '@/lib/auth/session.ts';
import { htmlArtifactHeaders } from '@/lib/docs/html-artifact.ts';
import { docArtifactPath } from '@/lib/docs/paths.ts';
import { signInNextPath } from '@/lib/docs/published.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const session = await getSession();
  const result = await resolveDocArtifact(id, session?.user.id ?? null);
  if (result.status === 'sign-in') {
    return new Response(null, {
      status: 302,
      headers: { location: signInNextPath(docArtifactPath(id)) },
    });
  }
  if (result.status === 'missing' || !isHtmlDoc(result.doc.kind)) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(result.doc.content, { headers: htmlArtifactHeaders() });
}
