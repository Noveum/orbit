import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { publishDeltas } from '@orbit/core';
import type { DomainError } from '@orbit/shared/errors';
import { toDomainError, validationFailed } from '@orbit/shared/errors';
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

export function allowTools(server: McpServer, access: ToolAccess): void {
  GRANTED.set(server, access);
}

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolPayload>,
): void {
  if (!canUseMcpTool(GRANTED.get(server) ?? DENY_EVERYTHING, config)) return;
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
        assertMcpToolAccess(GRANTED.get(server) ?? DENY_EVERYTHING, config);
        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error) {
        return failed(config.name, error);
      }
    },
  );
}
