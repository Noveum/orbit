export const DEV_LOGIN_HEADER = 'x-orbit-dev-login';

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env['ORBIT_DEV_LOGIN'] === '1';
}

export function isDevLoginRequest(context?: {
  readonly headers?: HeadersInit | undefined;
  readonly request?: Request | undefined;
}): boolean {
  if (!devLoginEnabled()) return false;
  const source = context?.headers ?? context?.request?.headers;
  if (source === undefined) return false;
  return new Headers(source).get(DEV_LOGIN_HEADER) === '1';
}
