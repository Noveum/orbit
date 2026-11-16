import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates, rootCertificates } from 'node:tls';
import { databaseTlsOptions } from '@orbit/db/connection';

export async function withDatabaseTlsContext<T>(
  connectionUrl: string,
  operation: (url: string) => Promise<T>,
): Promise<T> {
  const { ssl } = databaseTlsOptions(connectionUrl);
  if (ssl === undefined) return operation(connectionUrl);
  const directory = await mkdtemp(join(tmpdir(), 'orbit-database-tls-'));
  try {
    const certificatePath = join(directory, 'roots.pem');
    const roots =
      ssl.ca ??
      (typeof getCACertificates === 'function' ? getCACertificates('default') : rootCertificates);
    const certificates = Array.isArray(roots) ? roots.join('\n') : String(roots);
    await writeFile(certificatePath, certificates, { mode: 0o600, flag: 'wx' });
    const url = new URL(connectionUrl);
    url.searchParams.delete('ssl');
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.set('sslrootcert', certificatePath);
    return await operation(url.toString());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
