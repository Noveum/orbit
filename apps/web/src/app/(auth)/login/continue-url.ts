export function safeCallback(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^\/(?!\/)/.test(value) ? value : undefined;
}

const MCP_AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'prompt',
  'nonce',
] as const;

export function mcpContinueUrl(
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  if (typeof params['client_id'] !== 'string' || typeof params['response_type'] !== 'string') {
    return undefined;
  }
  const search = new URLSearchParams();
  for (const key of MCP_AUTHORIZE_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) search.set(key, value);
  }
  return `/api/auth/mcp/authorize?${search.toString()}`;
}
