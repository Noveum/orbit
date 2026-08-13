export interface SafeErrorFields extends Record<string, unknown> {
  readonly error: string;
  readonly errorName?: string;
  readonly errorCode?: string;
}

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;
const EMAIL_ADDRESS = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LONG_TOKEN = /\b(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]{24,}\b/gi;
const MAX_ERROR_LENGTH = 500;

function safeMessage(message: string): string {
  if (message.startsWith('Failed query:')) return 'Database query failed.';
  const firstLine = message.split(/\r?\n/, 1)[0] ?? '';
  return firstLine
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(EMAIL_ADDRESS, '[redacted-email]')
    .replace(LONG_TOKEN, '[redacted]')
    .slice(0, MAX_ERROR_LENGTH);
}

function errorChain(value: unknown): Error[] {
  const chain: Error[] = [];
  const seen = new Set<Error>();
  let current = value;
  while (current instanceof Error && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

function errorCode(chain: readonly Error[]): string | undefined {
  for (const error of [...chain].reverse()) {
    const code = (error as Error & { readonly code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return undefined;
}

export function safeErrorFields(value: unknown): SafeErrorFields {
  const chain = errorChain(value);
  const error = chain.at(-1);
  if (error === undefined) return { error: safeMessage(String(value)) };
  const code = errorCode(chain);
  return {
    error: safeMessage(error.message),
    errorName: error.name,
    ...(code === undefined ? {} : { errorCode: code }),
  };
}
