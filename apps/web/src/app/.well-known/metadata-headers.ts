export const METADATA_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

export function metadataPreflight(): Response {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS });
}
