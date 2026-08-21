import { isHtmlDoc } from '@orbit/shared/constants';
import { htmlArtifactHeaders } from '@/lib/docs/html-artifact.ts';
import { lookupPublishedDoc, signInNextPath } from '@/lib/docs/published.ts';

interface RouteContext {
  readonly params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  const result = await lookupPublishedDoc(token);
  if (result.status === 'sign-in') {
    return new Response(null, {
      status: 302,
      headers: { location: signInNextPath(`/h/${token}`) },
    });
  }
  if (result.status === 'missing' || !isHtmlDoc(result.detail.doc.kind)) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(result.detail.doc.content, { headers: htmlArtifactHeaders() });
}
