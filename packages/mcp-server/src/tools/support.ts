import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { drainIssueOutbox, publishDeltas } from '@orbit/core';
import { agentIssueWritesEnabled } from '@orbit/shared';
import type { DomainError } from '@orbit/shared/errors';
import { toDomainError, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { assertHumanIssueWriter } from '@orbit/shared/policy';
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
  if (actions.some((action) => action.eventId !== undefined)) {
    const ids = actions.flatMap((action) => (action.eventId === undefined ? [] : [action.eventId]));
    for (let index = 0; index < ids.length; index += 200) {
      await drainIssueOutbox({
        publish: async (batch) => {
          if (!process.env['REDIS_URL'])
            throw new Error('REDIS_URL is required for outbox delivery');
          await publishDeltas(batch);
        },
        batchSize: 200,
        eventIds: ids.slice(index, index + 200),
      });
    }
    return;
  }
  await publishDeltas([...actions]);
}

export interface ToolConfig<Shape extends z.ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
  readonly inputSchema: Shape;
}

export interface ToolAccess {
  readonly reads: boolean;
  readonly writes: boolean;
  readonly actorType?: 'user' | 'agent';
  readonly agentIssueWrite?: boolean;
}

const DENY_EVERYTHING: ToolAccess = { reads: false, writes: false };

const GRANTED = new WeakMap<McpServer, ToolAccess>();

const ISSUE_MUTATION_TOOLS = new Set([
  'archive_issue',
  'create_issue',
  'delete_issue',
  'move_issue',
  'move_to_cycle',
  'remove_relation',
  'set_relation',
  'unarchive_issue',
  'update_issue',
]);

export function allowTools(server: McpServer, access: ToolAccess): void {
  GRANTED.set(server, access);
}

function mayRegister(server: McpServer, readOnly: boolean): boolean {
  const access = GRANTED.get(server) ?? DENY_EVERYTHING;
  return readOnly ? access.reads : access.writes;
}

export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  config: ToolConfig<Shape>,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolPayload>,
): void {
  if (!mayRegister(server, config.readOnly)) return;
  const inputSchema = z.strictObject(config.inputSchema) as unknown as z.ZodObject<Shape>;
  server.registerTool<z.ZodRawShape, z.ZodObject<Shape>>(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema,
      annotations: {
        title: config.title,
        readOnlyHint: config.readOnly,
        destructiveHint: config.destructive ?? false,
        idempotentHint: config.readOnly || (config.idempotent ?? false),
        openWorldHint: config.openWorld ?? false,
      },
    },
    async (args) => {
      try {
        if (ISSUE_MUTATION_TOOLS.has(config.name)) {
          const access = GRANTED.get(server);
          if (
            !(
              (config.name === 'create_issue' ||
                config.name === 'update_issue' ||
                config.name === 'move_issue' ||
                config.name === 'archive_issue' ||
                config.name === 'unarchive_issue' ||
                config.name === 'delete_issue' ||
                config.name === 'set_relation' ||
                config.name === 'remove_relation') &&
              access?.actorType === 'agent' &&
              access.agentIssueWrite &&
              agentIssueWritesEnabled()
            )
          ) {
            assertHumanIssueWriter(access?.actorType ?? 'user');
          }
        }
        return ok(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (error) {
        return failed(config.name, error);
      }
    },
  );
}
