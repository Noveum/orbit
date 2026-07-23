import type { ErrorCode } from '@orbit/shared/errors';
import { ORIGIN_CLIENT_ID_HEADER } from '@orbit/shared/events';
import { z } from 'zod';
import { clientId } from './client-id.ts';

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  is(code: ErrorCode): boolean {
    return this.code === code;
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(path, {
    method,
    headers: {
      [ORIGIN_CLIENT_ID_HEADER]: clientId(),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new ApiError(response.status, 'internal', `Request to ${path} failed.`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, 'internal', `Unexpected response from ${path}.`, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function messageOf(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}
