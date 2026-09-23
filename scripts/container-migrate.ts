import { fileURLToPath } from 'node:url';
import { releaseDatabase } from '../packages/db/src/migration-release';

const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (url === undefined || url.length === 0) {
  throw new Error('Set DIRECT_URL or DATABASE_URL before starting Orbit.');
}
const result = await releaseDatabase(url, fileURLToPath(new URL('./migrations/', import.meta.url)));
console.info(`Database release ${result.mode}: ${result.applied} migrations applied.`);
