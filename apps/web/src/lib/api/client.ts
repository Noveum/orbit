'use client';

import type { ErrorCode } from '@orbit/shared/errors';
import { ORIGIN_CLIENT_ID_HEADER } from '@orbit/shared/events';
import { z } from 'zod';
import { clientId } from '@/lib/query/client-id.ts';

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }

  is(code: ErrorCode): boolean {
    return this.code === code;
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export async function apiRequest<T>(
  url: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      [ORIGIN_CLIENT_ID_HEADER]: clientId(),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(payload);
    throw new ApiRequestError(
      parsed.success ? parsed.data.error.code : 'internal',
      parsed.success ? parsed.data.error.message : 'Something went wrong.',
    );
  }
  return payload as T;
}
