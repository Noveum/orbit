import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import type { StorageDriver } from '../storage/types.ts';
import type { StorageCaptureResult } from './types.ts';

interface AttachmentRecord {
  readonly id: string;
  readonly storage_key: string;
  readonly size: number;
  readonly content_type: string;
}

export interface CaptureStorageOptions {
  readonly databaseUrl: string;
  readonly outputObjectsDir: string;
  readonly driver: StorageDriver;
}

export async function captureStorageObjects(
  options: CaptureStorageOptions,
): Promise<StorageCaptureResult> {
  const { databaseUrl, outputObjectsDir, driver } = options;
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, prepare: false });

  let records: AttachmentRecord[] = [];
  try {
    records = await sql<AttachmentRecord[]>`
      select id, storage_key, size, content_type
      from attachment
      where status = 'ready'
      order by id
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const objects: {
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contentType: string;
  }[] = [];

  for (const record of records) {
    const data = await driver.get(record.storage_key);
    if (data === null) {
      throw new Error(
        `Referenced object "${record.storage_key}" for attachment "${record.id}" was not found in object storage.`,
      );
    }

    const sha256 = createHash('sha256').update(data).digest('hex');
    const destinationPath = join(outputObjectsDir, record.storage_key);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, data);

    objects.push({
      key: record.storage_key,
      sha256,
      bytes: data.byteLength,
      contentType: record.content_type,
    });
  }

  return { objects };
}
