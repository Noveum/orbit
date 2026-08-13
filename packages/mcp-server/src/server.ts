import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { verifyMcpAccessToken } from '@orbit/core';
import { forbidden, toDomainError, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { errorFields, logger } from './logger.ts';
import { registerTools } from './tools/index.ts';
import { allowTools } from './tools/support.ts';

export const MCP_PATH = '/mcp';

const SERVER_VERSION = '0.0.0';
const JSONRPC_SERVER_ERROR = -32000;

const INSTRUCTIONS = [
  'Orbit is a task manager. Issues live on teams and carry identifiers such as ENG-42.',
  'Call get_me first to learn the caller role and teams, then list_teams, list_states and list_labels before writing.',
  'Every tool acts as the user who owns the API key, so a request can fail with a forbidden error when their role does not allow it.',
].join(' ');

export function wwwAuthenticate(publicUrl: string): string {
  const base = publicUrl.replace(/\/+$/, '');
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
}

export const ORBIT_READ_SCOPE = 'orbit.read';
export const ORBIT_WRITE_SCOPE = 'orbit.write';
const EVERY_ORBIT_SCOPE = `${ORBIT_READ_SCOPE} ${ORBIT_WRITE_SCOPE}`;

function granted(scopes: string): Set<string> {
  return new Set(scopes.split(/[\s,]+/).filter(Boolean));
}

export function grantsReads(scopes: string): boolean {
  return granted(scopes).has(ORBIT_READ_SCOPE);
}

export function grantsWrites(scopes: string): boolean {
  return granted(scopes).has(ORBIT_WRITE_SCOPE);
}

export function createOrbitMcpServer(principal: Principal, scopes = EVERY_ORBIT_SCOPE): McpServer {
  const server = new McpServer(
    { name: 'orbit', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  allowTools(server, { reads: grantsReads(scopes), writes: grantsWrites(scopes) });
  registerTools(server, principal);
  return server;
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw unauthorized('Sign in to Orbit to authorize this MCP client.');
  }
  return header.slice('bearer '.length).trim();
}

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: JSONRPC_SERVER_ERROR, message }, id: null },
    { status, headers },
  );
}

export interface McpRequestOptions {
  readonly publicUrl: string;
  readonly dispatch?: ((request: Request) => Promise<Response>) | undefined;
}

async function dispatch(request: Request): Promise<Response> {
  const identity = await verifyMcpAccessToken(bearerToken(request));
  if (!(grantsReads(identity.scopes) || grantsWrites(identity.scopes))) {
    throw forbidden('This client holds neither the orbit.read nor the orbit.write scope.');
  }
  const server = createOrbitMcpServer(identity.principal, identity.scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport as unknown as Transport);

  try {
    const response = await transport.handleRequest(request);
    logger.info('mcp request', {
      userId: identity.principal.userId,
      organizationId: identity.organizationId,
      clientId: identity.clientId,
    });
    return response;
  } finally {
    await transport.close().catch((error: unknown) => {
      logger.error('transport close failed', errorFields(error));
    });
    await server.close().catch((error: unknown) => {
      logger.error('server close failed', errorFields(error));
    });
  }
}

export async function handleMcpRequest(
  request: Request,
  options: McpRequestOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return rpcError(405, 'This endpoint only accepts POST.', { allow: 'POST' });
  }

  try {
    return await (options.dispatch ?? dispatch)(request);
  } catch (error: unknown) {
    const domain = toDomainError(error);
    const fields = { code: domain.code, ...errorFields(error) };
    if (domain.status >= 500) logger.error('request failed', fields);
    else logger.warn('request rejected', fields);
    const safe = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
    const headers =
      domain.status === 401 ? { 'WWW-Authenticate': wwwAuthenticate(options.publicUrl) } : {};
    return rpcError(domain.status, safe, headers);
  }
}
