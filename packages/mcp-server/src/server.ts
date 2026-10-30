import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { getOrganization, verifyMcpAccessToken } from '@orbit/core';
import { forbidden, toDomainError, unauthorized } from '@orbit/shared/errors';
import type { McpIdentity, Principal } from '@orbit/shared/policy';
import { errorFields, logger } from './logger.ts';
import { registerTools } from './tools/index.ts';
import { allowTools } from './tools/support.ts';

export const MCP_PATH = '/mcp';

const SERVER_VERSION = '0.0.0';
const JSONRPC_SERVER_ERROR = -32000;

const INSTRUCTIONS = [
  'Orbit is a task manager. Issues live on teams and carry identifiers such as ENG-42.',
  'Call get_me first to learn the caller role and teams, then list_teams, list_states and list_labels before writing.',
  'The Human Principal is the user who authorized the OAuth connection. get_me, me and my issues refer to that Human Principal.',
  'Every tool uses the current workspace permissions of that user and the connection scopes.',
].join(' ');

const AGENT_INSTRUCTIONS = [
  'Orbit is a task manager. Issues live on teams and carry identifiers such as ENG-42.',
  'This connection has an explicit Agent Identity and is read-only. Write tools and reads with write side effects are unavailable.',
  'Call get_agent_identity for the Agent Identity. get_me, me and my issues still refer to the Human Principal who authorized this connection.',
  'Available read tools use the current workspace permissions of that Human Principal and the orbit.read scope.',
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

export function createOrbitMcpServer(
  principal: Principal,
  scopes = EVERY_ORBIT_SCOPE,
  workspaceInstructions = '',
  identity: McpIdentity = { kind: 'legacy' },
): McpServer {
  const instructions = [
    identity.kind === 'agent' ? AGENT_INSTRUCTIONS : INSTRUCTIONS,
    workspaceInstructions,
  ]
    .filter((entry) => entry.length > 0)
    .join('\n\n');
  const server = new McpServer(
    { name: 'orbit', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions },
  );
  allowTools(server, { reads: grantsReads(scopes), writes: grantsWrites(scopes), identity });
  registerTools(server, principal, identity);
  return server;
}

async function requestInitializesConnection(request: Request): Promise<boolean> {
  try {
    const payload: unknown = await request.clone().json();
    const messages = Array.isArray(payload) ? payload : [payload];
    return messages.some(isInitializeRequest);
  } catch {
    return false;
  }
}

type WorkspaceInstructionsLoader = (organizationId: string) => Promise<string>;

async function loadWorkspaceInstructions(organizationId: string): Promise<string> {
  return (await getOrganization(organizationId)).agentInstructions;
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
  readonly loadWorkspaceInstructions?: WorkspaceInstructionsLoader | undefined;
}

async function dispatch(
  request: Request,
  instructionsLoader: WorkspaceInstructionsLoader,
): Promise<Response> {
  const identity = await verifyMcpAccessToken(bearerToken(request));
  if (!(grantsReads(identity.scopes) || grantsWrites(identity.scopes))) {
    throw forbidden('This client holds neither the orbit.read nor the orbit.write scope.');
  }
  const workspaceInstructions =
    grantsReads(identity.scopes) && (await requestInitializesConnection(request))
      ? await instructionsLoader(identity.organizationId)
      : '';
  const server = createOrbitMcpServer(
    identity.principal,
    identity.scopes,
    workspaceInstructions,
    identity.identity,
  );
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
    return await (options.dispatch === undefined
      ? dispatch(request, options.loadWorkspaceInstructions ?? loadWorkspaceInstructions)
      : options.dispatch(request));
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
