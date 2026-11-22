export interface SafeErrorFields extends Record<string, unknown> {
  readonly error: string;
  readonly errorName?: string;
  readonly errorCode?: string;
}

const MAX_ERROR_LENGTH = 500;
const EMAIL_LOCAL_CHARACTERS = new Set('abcdefghijklmnopqrstuvwxyz0123456789._%+-');
const EMAIL_DOMAIN_CHARACTERS = new Set('abcdefghijklmnopqrstuvwxyz0123456789.-');
const TOKEN_CHARACTERS = new Set('abcdefghijklmnopqrstuvwxyz0123456789_-');
const SCHEME_CHARACTERS = new Set('abcdefghijklmnopqrstuvwxyz0123456789+.-');

function isAsciiLetter(value: string): boolean {
  return value >= 'a' && value <= 'z';
}

function replaceUrlCredentials(value: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const schemeEnd = value.indexOf('://', cursor);
    if (schemeEnd === -1) return result + value.slice(cursor);
    let schemeStart = schemeEnd;
    while (
      schemeStart > cursor &&
      SCHEME_CHARACTERS.has(value[schemeStart - 1]?.toLowerCase() ?? '')
    ) {
      schemeStart -= 1;
    }
    const scheme = value.slice(schemeStart, schemeEnd);
    if (!isAsciiLetter(scheme[0]?.toLowerCase() ?? '')) {
      result += value.slice(cursor, schemeEnd + 3);
      cursor = schemeEnd + 3;
      continue;
    }
    const authorityStart = schemeEnd + 3;
    let authorityEnd = authorityStart;
    while (authorityEnd < value.length && !'/\\?#\r\n\t '.includes(value[authorityEnd] ?? '')) {
      authorityEnd += 1;
    }
    const at = value.indexOf('@', authorityStart);
    if (at === -1 || at >= authorityEnd) {
      result += value.slice(cursor, authorityEnd);
      cursor = authorityEnd;
      continue;
    }
    result += `${value.slice(cursor, authorityStart)}[redacted]@`;
    cursor = at + 1;
  }
  return result;
}

function emailAt(
  value: string,
  at: number,
): { readonly start: number; readonly end: number } | null {
  let start = at;
  while (start > 0 && EMAIL_LOCAL_CHARACTERS.has(value[start - 1]?.toLowerCase() ?? '')) start -= 1;
  if (start === at) return null;
  let end = at + 1;
  while (end < value.length && EMAIL_DOMAIN_CHARACTERS.has(value[end]?.toLowerCase() ?? ''))
    end += 1;
  const domain = value.slice(at + 1, end);
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || domain.length - dot < 3) return null;
  return { start, end };
}

function replaceEmails(value: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const at = value.indexOf('@', cursor);
    if (at === -1) return result + value.slice(cursor);
    const email = emailAt(value, at);
    if (email === null) {
      result += value.slice(cursor, at + 1);
      cursor = at + 1;
      continue;
    }
    result += `${value.slice(cursor, email.start)}[redacted-email]`;
    cursor = email.end;
  }
  return result;
}

function sensitiveToken(value: string): boolean {
  if (value.length < 24) return false;
  let hasLetter = false;
  let hasDigit = false;
  for (const character of value) {
    if (!TOKEN_CHARACTERS.has(character.toLowerCase())) return false;
    if (isAsciiLetter(character.toLowerCase())) hasLetter = true;
    if (character >= '0' && character <= '9') hasDigit = true;
  }
  return hasLetter && hasDigit;
}

function replaceLongTokens(value: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    if (!TOKEN_CHARACTERS.has(value[cursor]?.toLowerCase() ?? '')) {
      result += value[cursor];
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < value.length && TOKEN_CHARACTERS.has(value[end]?.toLowerCase() ?? '')) end += 1;
    const token = value.slice(cursor, end);
    result += sensitiveToken(token) ? '[redacted]' : token;
    cursor = end;
  }
  return result;
}

function safeMessage(message: string): string {
  if (message.startsWith('Failed query:')) return 'Database query failed.';
  const lineEnd = Math.min(
    ...[message.indexOf('\r'), message.indexOf('\n'), MAX_ERROR_LENGTH].filter(
      (index) => index >= 0,
    ),
  );
  const firstLine = message.slice(0, lineEnd);
  return replaceLongTokens(replaceEmails(replaceUrlCredentials(firstLine))).slice(
    0,
    MAX_ERROR_LENGTH,
  );
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

const databaseCodes = new Set([
  '08001',
  '08003',
  '08006',
  '22001',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  '28000',
  '28P01',
  '40001',
  '40P01',
  '42501',
  '42601',
  '42703',
  '42P01',
  '53300',
  '55P03',
  '57014',
  '57P01',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isDatabaseError(entry: object): boolean {
  const proto: unknown = Object.getPrototypeOf(entry);
  const name =
    ownValue(entry, 'name') ??
    (proto === null || typeof proto !== 'object' ? undefined : ownValue(proto, 'name'));
  const message = ownValue(entry, 'message');
  return (
    name === 'PostgresError' ||
    name === 'DatabaseError' ||
    name === 'DrizzleQueryError' ||
    (typeof message === 'string' && message.includes('Failed query:')) ||
    (Object.hasOwn(entry, 'query') &&
      (Object.hasOwn(entry, 'params') || Object.hasOwn(entry, 'parameters')))
  );
}

function* errorObjects(value: unknown): Generator<object> {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === null || typeof entry !== 'object' || seen.has(entry)) continue;
    seen.add(entry);
    yield entry;
    pending.push(ownValue(entry, 'cause'));
    const children = ownValue(entry, 'errors');
    if (entry instanceof AggregateError && Array.isArray(children)) {
      for (const child of children) pending.push(child);
    }
  }
}

export function databaseLogFields(value: unknown): SafeErrorFields | undefined {
  let database = typeof value === 'string' && value.includes('Failed query:');
  const codes = new Set<string>();
  for (const entry of errorObjects(value)) {
    if (isDatabaseError(entry)) database = true;
    const candidate = ownValue(entry, 'code');
    if (typeof candidate !== 'string') continue;
    if (/^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[A-Z0-9]{3}$/.test(candidate)) database = true;
    if (databaseCodes.has(candidate)) codes.add(candidate);
  }
  const [code] = codes.size === 1 ? codes : [];
  return database
    ? {
        error: 'Database query failed.',
        errorName: 'DatabaseError',
        ...(code === undefined ? {} : { errorCode: code }),
      }
    : undefined;
}

export async function withDatabaseLogBoundary<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const fields = databaseLogFields(error);
    if (fields === undefined) throw error;
    throw Object.assign(new Error(fields.error), {
      name: 'DatabaseError',
      ...(fields.errorCode === undefined ? {} : { code: fields.errorCode }),
    });
  }
}

export function safeErrorFields(value: unknown): SafeErrorFields {
  const database = databaseLogFields(value);
  if (database !== undefined) return database;
  const chain = errorChain(value);
  const error = chain.at(-1);
  if (error === undefined) return { error: safeMessage(String(value)) };
  const code = errorCode(chain);
  return {
    error: safeMessage(error.message),
    errorName: safeMessage(error.name),
    ...(code === undefined ? {} : { errorCode: safeMessage(code) }),
  };
}
