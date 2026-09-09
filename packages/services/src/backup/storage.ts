import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { internal } from '@orbit/shared';
import { assertSafeKey } from '../storage/key.ts';
import type { StorageDriver } from '../storage/types.ts';
import type { AttachmentRecord, StorageCaptureResult } from './types.ts';

export interface CaptureStorageOptions {
  readonly records: readonly AttachmentRecord[];
  readonly outputObjectsDir: string;
  readonly driver: StorageDriver;
}

export async function captureStorageObjects(
  options: CaptureStorageOptions,
): Promise<StorageCaptureResult> {
  const { records, outputObjectsDir, driver } = options;

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
      throw internal(
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
