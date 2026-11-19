const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export async function forwardRequest(url: URL, request: Request): Promise<Request> {
  const init: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: request.redirect,
    signal: request.signal,
  };
  if (!BODYLESS_METHODS.has(request.method.toUpperCase())) {
    init.body = await request.arrayBuffer();
  }
  return new Request(url, init);
}
