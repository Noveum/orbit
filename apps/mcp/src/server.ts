import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { verifyApiKey } from '@orbit/core';
import { toDomainError, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { errorFields, logger } from './logger.ts';
import { registerTools } from './tools/index.ts';

export const MCP_PATH = '/mcp';
export const HEALTH_PATH = '/health';

const SERVER_VERSION = '0.0.0';
const JSONRPC_SERVER_ERROR = -32000;

const INSTRUCTIONS = [
  'Orbit is a work tracker. Issues live on teams and carry identifiers such as ENG-42.',
  'Call get_me first to learn the caller role and teams, then list_teams, list_states and list_labels before writing.',
  'Every tool acts as the user who owns the API key, so a request can fail with a forbidden error when their role does not allow it.',
].join(' ');

export function createOrbitMcpServer(principal: Principal): McpServer {
  const server = new McpServer(
    { name: 'orbit', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerTools(server, principal);
  return server;
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw unauthorized('Send an Orbit API key as a bearer token.');
  }
  return header.slice('bearer '.length).trim();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendRpcError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, {
    jsonrpc: '2.0',
    error: { code: JSONRPC_SERVER_ERROR, message },
    id: null,
  });
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const identity = await verifyApiKey(bearerToken(request));
  const server = createOrbitMcpServer(identity.principal);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  response.on('close', () => {
    transport.close().catch((error: unknown) => {
      logger.error('transport close failed', errorFields(error));
    });
    server.close().catch((error: unknown) => {
      logger.error('server close failed', errorFields(error));
    });
  });
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(request, response);
  logger.info('mcp request', {
    userId: identity.principal.userId,
    organizationId: identity.principal.organizationId,
    apiKeyId: identity.apiKey.id,
  });
}

function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://orbit.mcp');
  if (url.pathname === HEALTH_PATH) {
    sendJson(response, 200, { status: 'ok', service: 'mcp' });
    return Promise.resolve();
  }
  if (url.pathname !== MCP_PATH) {
    sendRpcError(response, 404, 'Unknown endpoint.');
    return Promise.resolve();
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendRpcError(response, 405, 'This endpoint only accepts POST.');
    return Promise.resolve();
  }
  return handleMcpRequest(request, response);
}

export interface McpHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface McpHttpServerOptions {
  readonly port?: number;
  readonly host?: string;
}

export async function createMcpHttpServer(
  options: McpHttpServerOptions = {},
): Promise<McpHttpServer> {
  const http = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      const domain = toDomainError(error);
      logger.error('request failed', { code: domain.code, ...errorFields(error) });
      if (response.headersSent) {
        response.end();
        return;
      }
      const safe = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
      sendRpcError(response, domain.status, safe);
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      http.off('error', reject);
      resolve();
    });
  });

  const address = http.address() as AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error === undefined ? resolve() : reject(error)));
        http.closeAllConnections();
      }),
  };
}
