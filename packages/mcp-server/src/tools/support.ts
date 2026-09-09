import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  claimIdempotencySlot,
  hashParams,
  publishDeltas,
  resolveIdempotencySlot,
} from '@orbit/core';
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
  readonly inputSchema: Shape;
}

export interface ToolAccess {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly grantId?: string | undefined;
}

const DENY_EVERYTHING: ToolAccess = { reads: false, writes: false };

const GRANTED = new WeakMap<McpServer, ToolAccess>();

export function allowTools(server: McpServer, access: ToolAccess): void {
  GRANTED.set(server, access);
}

function mayRegister(server: McpServer, readOnly: boolean): boolean {
  const access = GRANTED.get(server) ?? DENY_EVERYTHING;
  return readOnly ? access.reads : access.writes;
}

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe('Optional idempotency key to prevent duplicate execution on retries.');

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolPayload>,
): void {
  if (!mayRegister(server, config.readOnly)) return;
  const rawSchema = config.readOnly
    ? config.inputSchema
    : { ...config.inputSchema, idempotencyKey: idempotencyKeySchema };
  const inputSchema = z.strictObject(rawSchema) as unknown as z.ZodObject<Shape>;
  const description = config.readOnly
    ? config.description
    : `${config.description} Accepts an optional idempotencyKey to prevent duplicate execution on retries.`;
  server.registerTool<z.ZodRawShape, z.ZodObject<Shape>>(
    config.name,
    {
      title: config.title,
      description,
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
        const access = GRANTED.get(server);
        const grantId = access?.grantId;
        const rawArgs = args as Record<string, unknown>;
        const idempotencyKey =
          typeof rawArgs['idempotencyKey'] === 'string' ? rawArgs['idempotencyKey'] : undefined;

        if (
          !config.readOnly &&
          idempotencyKey !== undefined &&
          idempotencyKey.length > 0 &&
          grantId !== undefined
        ) {
          const { idempotencyKey: _, ...restArgs } = rawArgs;
          const paramsHash = hashParams(restArgs);
          const slot = await claimIdempotencySlot(grantId, idempotencyKey, config.name, paramsHash);
          if (slot.status === 'done') {
            logger.info('idempotent tool response returned', {
              tool: config.name,
              idempotencyKey,
              grantId,
            });
            return ok(slot.response);
          }
          if (slot.status === 'processing') {
            return ok({
              retryAfterMs: 500,
              message: 'Request is still processing. Retry shortly.',
            });
          }
          const result = await run(args as z.infer<z.ZodObject<Shape>>);
          await resolveIdempotencySlot(slot.slotId, result);
          return ok(result);
        }

        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error) {
        return failed(config.name, error);
      }
    },
  );
}
