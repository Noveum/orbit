import { createHash } from 'node:crypto';
import { validationFailed } from '@orbit/shared';
import { assertSafeKey } from '../storage/key.ts';
import { openValidatedFile } from './checksums.ts';
import type { RestoreStorageOptions, RestoreStorageResult } from './types.ts';

export async function restoreStorageObjects(
  options: RestoreStorageOptions,
): Promise<RestoreStorageResult> {
  const { objectsDir, expectedObjects, driver } = options;

  let uploadedCount = 0;
  let verifiedCount = 0;

  for (const expected of expectedObjects) {
    const safeKey = assertSafeKey(expected.key);
    const contentType = expected.contentType ?? 'application/octet-stream';

    const existingStat = await driver.stat(safeKey);
    if (existingStat !== null && existingStat.size === expected.bytes) {
      const existingData = await driver.get(safeKey);
      if (existingData !== null) {
        const existingSha256 = createHash('sha256').update(existingData).digest('hex');
        if (existingSha256.toLowerCase() === expected.sha256.toLowerCase()) {
          verifiedCount += 1;
          continue;
        }
      }
    }

    const handle = await openValidatedFile(objectsDir, safeKey);
    let data: Buffer;
    try {
      data = await handle.readFile();
    } finally {
      await handle.close();
    }

    if (data.byteLength !== expected.bytes) {
      throw validationFailed(
        `Backup object "${expected.key}" size mismatch: expected ${expected.bytes} bytes, found ${data.byteLength} bytes.`,
      );
    }
    const sourceSha256 = createHash('sha256').update(data).digest('hex');
    if (sourceSha256.toLowerCase() !== expected.sha256.toLowerCase()) {
      throw validationFailed(
        `Backup object "${expected.key}" checksum mismatch: expected ${expected.sha256}, found ${sourceSha256}.`,
      );
    }

    await driver.put(safeKey, data, contentType);
    uploadedCount += 1;
  }

  return { uploadedCount, verifiedCount };
}
