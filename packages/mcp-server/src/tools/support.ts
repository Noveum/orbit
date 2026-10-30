import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type AgentIssueWriteContext, isAgentIssueWriteEnabled, publishDeltas } from '@orbit/core';
import type { DomainError } from '@orbit/shared/errors';
import { forbidden, toDomainError, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { assertMcpToolAccess, canUseMcpTool, type McpToolAccess } from '@orbit/shared/policy';
import { z } from 'zod';
import { errorFields, logger } from '../logger.ts';

export type ToolPayload = Record<string, unknown>;

export function ok(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function asDomainError(error: unknown): DomainError {
  if (error instanceof z.ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    return validationFailed(detail);
  }
  return toDomainError(error);
}

export function failed(name: string, error: unknown): CallToolResult {
  const domain = asDomainError(error);
  logger.warn('tool failed', { tool: name, code: domain.code, ...errorFields(error) });
  const body =
    domain.status >= 500
      ? { error: { code: domain.code, message: 'Something went wrong on our side.' } }
      : domain.toJSON();
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  };
}

export async function publish(actions: readonly SyncAction[]): Promise<void> {
  await publishDeltas([...actions]);
}

export interface ToolConfig<Shape extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly agentSafe?: boolean;
  readonly agentWrite?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
  readonly inputSchema: Shape;
}

export type ToolAccess = McpToolAccess;

const DENY_EVERYTHING: ToolAccess = {
  reads: false,
  writes: false,
  identity: { kind: 'legacy' },
};

const GRANTED = new WeakMap<McpServer, ToolAccess>();
const WRITE_CONTEXTS = new WeakMap<McpServer, AgentIssueWriteContext>();

export function allowTools(
  server: McpServer,
  access: ToolAccess,
  context?: AgentIssueWriteContext,
): void {
  GRANTED.set(server, access);
  if (context !== undefined) WRITE_CONTEXTS.set(server, context);
}

function currentToolAccess(server: McpServer): ToolAccess {
  const access = GRANTED.get(server) ?? DENY_EVERYTHING;
  const context = WRITE_CONTEXTS.get(server);
  const agentIssueWrites =
    access.identity.kind === 'agent' &&
    context?.identityId === access.identity.id &&
    context.scopes.split(/\s+/).includes('orbit.write') &&
    isAgentIssueWriteEnabled();
  return { ...access, agentIssueWrites };
}

export function canWriteAgentIssues(server: McpServer): boolean {
  const access = currentToolAccess(server);
  return (
    access.identity.kind === 'agent' && canUseMcpTool(access, { readOnly: false, agentWrite: true })
  );
}

export function issueWriteContextFor(server: McpServer): AgentIssueWriteContext | undefined {
  if (GRANTED.get(server)?.identity.kind !== 'agent') return undefined;
  const context = WRITE_CONTEXTS.get(server);
  if (context === undefined) throw forbidden('A verified Agent write context is required.');
  return context;
}

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolPayload>,
): void {
  if (!canUseMcpTool(currentToolAccess(server), config)) return;
  const inputSchema = z.strictObject(config.inputSchema) as unknown as z.ZodObject<Shape>;
  server.registerTool<z.ZodRawShape, z.ZodObject<Shape>>(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: {
        title: config.title,
        readOnlyHint: config.readOnly && config.agentSafe !== false,
        destructiveHint: config.destructive ?? false,
        idempotentHint:
          (config.readOnly && config.agentSafe !== false) || (config.idempotent ?? false),
        openWorldHint: config.openWorld ?? false,
      },
    },
    async (args) => {
      try {
        assertMcpToolAccess(currentToolAccess(server), config);
        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error) {
        return failed(config.name, error);
      }
    },
  );
}
