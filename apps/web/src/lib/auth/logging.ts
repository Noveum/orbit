import { databaseLogFields } from '@orbit/shared/utils';
import type { BetterAuthOptions } from 'better-auth';

const knownAuthStates = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TOO_MANY_REQUESTS',
  'INTERNAL_SERVER_ERROR',
]);

const authLogger = {
  log(level, message: unknown, ...details: unknown[]) {
    const database = [message, ...details]
      .map(databaseLogFields)
      .find((fields) => fields !== undefined);
    const event =
      typeof message === 'string' && knownAuthStates.has(message) ? message : 'auth.diagnostic';
    const fields = database ?? { event };
    if (level === 'error') console.error('Authentication diagnostic', fields);
    else if (level === 'warn') console.warn('Authentication diagnostic', fields);
    else console.info('Authentication diagnostic', fields);
  },
} satisfies NonNullable<BetterAuthOptions['logger']>;

export const authLoggingOptions = {
  logger: authLogger,
  onAPIError: { throw: true },
} satisfies Pick<BetterAuthOptions, 'logger' | 'onAPIError'>;

export function authHttpHandler(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      const fields = databaseLogFields(error);
      if (fields === undefined) throw error;
      console.error('Authentication database error', fields);
      return new Response(null, { status: 500, statusText: 'Internal Server Error' });
    }
  };
}
