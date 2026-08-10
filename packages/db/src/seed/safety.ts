import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { z } from 'zod';

const seedResetInputSchema = z.object({
  databaseUrl: z.url(),
  confirmation: z.string().optional(),
});

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const RAW_URL_CONTROL_PATTERN = /[\t\n\r]/;
const DEFAULT_DOCKER_HOSTS = new Set(['localhost', '127.0.0.1']);
const DEFAULT_DOCKER_PORT = '5434';
const DEFAULT_DOCKER_DATABASE = 'orbit';
const DEFAULT_DOCKER_USERNAME = 'orbit';
const DEFAULT_DOCKER_PASSWORD = 'orbit';
const TARGET_CHANGING_QUERY_KEYS = new Set([
  'database',
  'db',
  'dbname',
  'host',
  'hostaddr',
  'hostname',
  'options',
  'pass',
  'password',
  'port',
  'role',
  'schema',
  'search_path',
  'service',
  'session_authorization',
  'user',
  'username',
]);
const INVALID_TARGET_MESSAGE =
  'DATABASE_URL must be a valid PostgreSQL connection URL with a database name before db:seed can reset it.';
const MISSING_NON_DEFAULT_PORT_MESSAGE =
  'DATABASE_URL must include an explicit port for a non-default db:seed target.';
const MISSING_NON_DEFAULT_USERNAME_MESSAGE =
  'DATABASE_URL must include an explicit username for a non-default db:seed target.';
const IPV6_DRIVER_MESSAGE =
  'DATABASE_URL cannot use an IPv6 host because the current database driver misparses bracketed IPv6 connection URLs.';
const TARGET_CHANGING_OPTION_MESSAGE =
  'DATABASE_URL contains a connection option that can change the database or schema targeted by db:seed.';
const NUL_OPTION_MESSAGE = 'DATABASE_URL contains an unsafe NUL byte in a connection option.';
const NUL_CREDENTIAL_MESSAGE = 'DATABASE_URL contains an unsafe NUL byte in database credentials.';

function invalidTarget(): never {
  throw new Error(INVALID_TARGET_MESSAGE);
}

function isDefaultDockerTarget(
  hostname: string,
  port: string,
  databaseName: string,
  username: string,
  password: string,
): boolean {
  return (
    DEFAULT_DOCKER_HOSTS.has(hostname) &&
    port === DEFAULT_DOCKER_PORT &&
    databaseName === DEFAULT_DOCKER_DATABASE &&
    username === DEFAULT_DOCKER_USERNAME &&
    password === DEFAULT_DOCKER_PASSWORD
  );
}

function isIpv6Host(hostname: string): boolean {
  if (!(hostname.startsWith('[') && hostname.endsWith(']'))) return false;
  return isIPv6(hostname.slice(1, -1));
}

function hasAmbiguousAuthority(databaseUrl: string): boolean {
  const authorityStart = databaseUrl.indexOf('://') + 3;
  const remainder = databaseUrl.slice(authorityStart);
  const authorityLength = remainder.search(/[/?#]/);
  const authority = authorityLength === -1 ? remainder : remainder.slice(0, authorityLength);
  const separatorCount = authority.split('@').length - 1;
  if (separatorCount > 1) return true;

  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  try {
    return decodeURIComponent(hostAndPort) !== hostAndPort || hostAndPort.includes(',');
  } catch {
    return true;
  }
}

function hasTargetChangingOption(parsed: URL): boolean {
  for (const key of parsed.searchParams.keys()) {
    if (TARGET_CHANGING_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function hasNulQueryParameter(parsed: URL): boolean {
  for (const [key, value] of parsed.searchParams) {
    if (key.includes('\0') || value.includes('\0')) return true;
  }
  return false;
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    invalidTarget();
  }
}

function usernameFingerprint(username: string): string {
  return createHash('sha256').update(username).digest('hex');
}

export function assertSeedResetAllowed(databaseUrl: unknown, confirmation: unknown): void {
  const input = seedResetInputSchema.safeParse({ databaseUrl, confirmation });
  if (!input.success) invalidTarget();
  if (RAW_URL_CONTROL_PATTERN.test(input.data.databaseUrl)) invalidTarget();
  if (hasAmbiguousAuthority(input.data.databaseUrl)) invalidTarget();

  let parsed: URL;
  try {
    parsed = new URL(input.data.databaseUrl);
  } catch {
    invalidTarget();
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.slice(1);
  if (
    !POSTGRES_PROTOCOLS.has(parsed.protocol) ||
    hostname.length === 0 ||
    databaseName.length === 0
  ) {
    invalidTarget();
  }
  if (isIpv6Host(hostname)) throw new Error(IPV6_DRIVER_MESSAGE);

  const username = decodeCredential(parsed.username);
  const password = decodeCredential(parsed.password);
  if (username.includes('\0') || password.includes('\0')) throw new Error(NUL_CREDENTIAL_MESSAGE);
  if (hasNulQueryParameter(parsed)) throw new Error(NUL_OPTION_MESSAGE);
  if (hasTargetChangingOption(parsed)) throw new Error(TARGET_CHANGING_OPTION_MESSAGE);
  if (isDefaultDockerTarget(hostname, parsed.port, databaseName, username, password)) return;
  if (parsed.port.length === 0) throw new Error(MISSING_NON_DEFAULT_PORT_MESSAGE);
  if (username.length === 0) throw new Error(MISSING_NON_DEFAULT_USERNAME_MESSAGE);

  const target = `${hostname}:${parsed.port}/${databaseName}:user-sha256:${usernameFingerprint(username)}`;
  if (input.data.confirmation === target) return;

  throw new Error(
    `Refusing to reset ${target}. Set ORBIT_SEED_CONFIRM_TARGET=${target} to confirm this destructive operation.`,
  );
}
