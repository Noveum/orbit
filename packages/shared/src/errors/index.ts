export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation_failed',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal: 500,
};

export interface DomainErrorOptions {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: { ...this.details } }),
      },
    };
  }
}

export const unauthorized = (message = 'Sign in to continue.', options?: DomainErrorOptions) =>
  new DomainError('unauthorized', message, options);

export const forbidden = (
  message = 'You do not have access to this.',
  options?: DomainErrorOptions,
) => new DomainError('forbidden', message, options);

export const notFound = (message = 'That does not exist.', options?: DomainErrorOptions) =>
  new DomainError('not_found', message, options);

export const conflict = (message: string, options?: DomainErrorOptions) =>
  new DomainError('conflict', message, options);

export const validationFailed = (message: string, options?: DomainErrorOptions) =>
  new DomainError('validation_failed', message, options);

export const rateLimited = (message = 'Too many requests. Try again shortly.') =>
  new DomainError('rate_limited', message);

export const payloadTooLarge = (message: string, options?: DomainErrorOptions) =>
  new DomainError('payload_too_large', message, options);

export const unsupportedMediaType = (message: string, options?: DomainErrorOptions) =>
  new DomainError('unsupported_media_type', message, options);

export const internal = (message = 'Something went wrong on our side.', cause?: unknown) =>
  new DomainError('internal', message, cause === undefined ? {} : { cause });

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export function toDomainError(value: unknown): DomainError {
  if (isDomainError(value)) return value;
  if (value instanceof Error) return internal(value.message, value);
  return internal('Something went wrong on our side.', value);
}
