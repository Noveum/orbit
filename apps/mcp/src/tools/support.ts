import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { publishDeltas } from '@orbit/core';
import type { DomainError } from '@orbit/shared/errors';
import { toDomainError, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
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
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(domain.toJSON()) }],
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
  readonly inputSchema: Shape;
}

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolPayload>,
): void {
  const inputSchema = z.object(config.inputSchema) as unknown as z.ZodObject<Shape>;
  server.registerTool<z.ZodRawShape, z.ZodObject<Shape>>(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: {
        title: config.title,
        readOnlyHint: config.readOnly,
        destructiveHint: false,
        idempotentHint: config.readOnly,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error) {
        return failed(config.name, error);
      }
    },
  );
}
