import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { assertSafeKey } from '../storage/key.ts';
import type { StorageDriver } from '../storage/types.ts';
import type { AttachmentRecord, StorageCaptureResult } from './types.ts';

export interface CaptureStorageOptions {
  readonly databaseUrl?: string | undefined;
  readonly records?: readonly AttachmentRecord[] | undefined;
  readonly outputObjectsDir: string;
  readonly driver: StorageDriver;
}

export async function captureStorageObjects(
  options: CaptureStorageOptions,
): Promise<StorageCaptureResult> {
  const { databaseUrl, records: passedRecords, outputObjectsDir, driver } = options;

  let records: readonly AttachmentRecord[];
  if (passedRecords !== undefined) {
    records = passedRecords;
  } else if (databaseUrl === undefined) {
    records = [];
  } else {
    const sql = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      idle_timeout: 10,
      prepare: false,
    });
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
  }

  const objects: {
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contentType: string;
  }[] = [];

  for (const record of records) {
    const safeKey = assertSafeKey(record.storage_key);
    const data = await driver.get(safeKey);
    if (data === null) {
      throw new Error(
        `Referenced object "${safeKey}" for attachment "${record.id}" was not found in object storage.`,
      );
    }

    const sha256 = createHash('sha256').update(data).digest('hex');
    const destinationPath = join(outputObjectsDir, safeKey);
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    await writeFile(destinationPath, data, { mode: 0o600 });

    objects.push({
      key: safeKey,
      sha256,
      bytes: data.byteLength,
      contentType: record.content_type,
    });
  }

  return { objects };
}
