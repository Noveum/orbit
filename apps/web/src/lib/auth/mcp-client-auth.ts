import { db, eq, schema } from '@orbit/db';

export async function providerClientRequest(
  request: Request,
  body: Readonly<Record<string, unknown>>,
): Promise<{ request: Request; body: Record<string, unknown> }> {
  if (
    request.headers.has('authorization') ||
    typeof body['client_id'] !== 'string' ||
    typeof body['client_secret'] !== 'string' ||
    body['client_assertion'] !== undefined ||
    body['client_assertion_type'] !== undefined
  )
    return { request, body };
  const [client] = await db
    .select()
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, body['client_id']))
    .limit(1);
  if (
    client?.legacyAuthMethods !== true ||
    client.tokenEndpointAuthMethod !== 'client_secret_basic'
  ) {
    return { request, body };
  }
  const headers = new Headers(request.headers);
  headers.set(
    'authorization',
    `Basic ${Buffer.from(`${encodeURIComponent(body['client_id'])}:${encodeURIComponent(body['client_secret'])}`).toString('base64')}`,
  );
  headers.delete('content-length');
  const normalized = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'client_secret'),
  );
  const mediaType = headers.get('content-type')?.split(';')[0]?.trim();
  const encoded =
    mediaType === 'application/x-www-form-urlencoded'
      ? new URLSearchParams(
          Object.entries(normalized).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ),
        ).toString()
      : JSON.stringify(normalized);
  return {
    request: new Request(request.url, { method: 'POST', headers, body: encoded }),
    body: normalized,
  };
}
