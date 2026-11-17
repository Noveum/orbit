import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import * as tls from 'node:tls';
import { databaseTlsEnvironmentSchema } from '@orbit/shared/validators';

const INVALID_TLS =
  'Invalid database TLS configuration. Require verified TLS with optional public CA certificates.';

export function databaseTlsOptions(
  connectionString: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { ssl?: ConnectionOptions } {
  const ssl = resolveDatabaseTls(connectionString, environment);
  return ssl === undefined ? {} : { ssl };
}

export function resolveDatabaseTls(
  connectionString: string,
  environment: Readonly<Record<string, string | undefined>>,
): ConnectionOptions | undefined {
  const parsed = databaseTlsEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error(INVALID_TLS);
  if (parsed.data.DATABASE_REQUIRE_TLS === 'false') return undefined;
  if (environment['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') throw new Error(INVALID_TLS);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(INVALID_TLS);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(INVALID_TLS);
  for (const [key] of url.searchParams) {
    if (key.toLowerCase().startsWith('ssl') && key !== 'ssl' && key !== 'sslmode') {
      throw new Error(INVALID_TLS);
    }
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const identity: ConnectionOptions = isIP(hostname)
    ? {
        checkServerIdentity: (_hostname, certificate) =>
          tls.checkServerIdentity(hostname, certificate),
      }
    : {};
  const pem = parsed.data.DATABASE_TLS_CA_PEM;
  if (pem === undefined) return { rejectUnauthorized: true, ...identity };
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
  if (
    certificates === null ||
    certificates.join('').replace(/\s/gu, '') !== pem.replace(/\s/gu, '')
  ) {
    throw new Error(INVALID_TLS);
  }
  try {
    for (const certificate of certificates) new X509Certificate(certificate);
  } catch {
    throw new Error(INVALID_TLS);
  }
  const standardRoots =
    typeof tls.getCACertificates === 'function'
      ? tls.getCACertificates('default')
      : tls.rootCertificates;
  return { rejectUnauthorized: true, ...identity, ca: [...standardRoots, ...certificates] };
}
